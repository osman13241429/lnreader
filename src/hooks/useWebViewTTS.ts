import { useEffect, useCallback, useRef } from 'react';
import WebView from 'react-native-webview';
import * as Speech from 'expo-speech';
import { MMKVStorage, getMMKVObject } from '@utils/mmkv/mmkv';
import {
  CHAPTER_GENERAL_SETTINGS,
  CHAPTER_READER_SETTINGS,
  ChapterGeneralSettings,
  ChapterReaderSettings,
  initialChapterGeneralSettings,
  initialChapterReaderSettings,
} from '@hooks/persisted/useSettings';
import { ChapterInfo } from '@database/types';
import { EdgeTTSClient, OUTPUT_FORMAT } from '@services/tts/EdgeTTSProvider';
import * as FileSystem from 'expo-file-system';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';

// Type definitions (could be moved to a types file later)
type WebViewPostEvent = {
  type: string;
  data?: string | number | { [key: string]: string | number } | null;
};

// Define the return type for the hook
interface UseWebViewTTSResult {
  injectTTSLogic: () => void;
  processTTSMessage: (event: WebViewPostEvent) => Promise<boolean>;
  stopTTSAndClearState: () => void;
}

// MMKV Keys for TTS state
const TTS_AUTO_START_FLAG = 'TTS_AUTO_START_FLAG';
const TTS_CHAPTERS_READ_COUNT = 'TTS_CHAPTERS_READ_COUNT';
const TTS_SLEEP_TIMER_EXPIRY = 'TTS_SLEEP_TIMER_EXPIRY';

// MMKV Helper Functions (Scoped within the hook or file)
const setShouldAutoStartTTS = (value: boolean) =>
  MMKVStorage.set(TTS_AUTO_START_FLAG, value);
const getShouldAutoStartTTS = (): boolean =>
  MMKVStorage.getBoolean(TTS_AUTO_START_FLAG) || false;

const setSleepTimerExpiry = (expiryTime: number | null) => {
  if (expiryTime === null) {
    MMKVStorage.delete(TTS_SLEEP_TIMER_EXPIRY);
  } else {
    MMKVStorage.set(TTS_SLEEP_TIMER_EXPIRY, expiryTime);
  }
};

const getSleepTimerExpiry = (): number | null =>
  MMKVStorage.getNumber(TTS_SLEEP_TIMER_EXPIRY) || null;

const getChaptersReadCount = (
  generalSettings: ChapterGeneralSettings,
): number => {
  if (!generalSettings.TTSReadMultipleChapters) {
    return 0;
  }
  return MMKVStorage.getNumber(TTS_CHAPTERS_READ_COUNT) || 0;
};

const setChaptersReadCount = (
  count: number,
  generalSettings: ChapterGeneralSettings,
) => {
  if (generalSettings.TTSReadMultipleChapters) {
    MMKVStorage.set(TTS_CHAPTERS_READ_COUNT, count);
  } else {
    MMKVStorage.delete(TTS_CHAPTERS_READ_COUNT);
  }
};

// Helper function to convert Uint8Array to Base64 string
function uint8ArrayToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

// Helper to handle edge cases with special characters for Edge TTS
function sanitizeTextForEdgeTTS(text: string): string {
  return text
    .replace(/<<|>>/g, '"') // Replace << and >> with quotes
    .replace(/[^\p{L}\p{N}\p{P}\p{Z}]/gu, ' '); // Remove non-alphanumeric, punctuation, or space chars
}

export const useWebViewTTS = (
  webViewRef: React.RefObject<WebView>,
  nextChapter: ChapterInfo | undefined,
  navigateChapter: (position: 'NEXT' | 'PREV') => void,
  chapterId: number | undefined, // Use undefined initially if chapter is not loaded
): UseWebViewTTSResult => {
  // TTS State Refs
  const sleepTimerTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldAutoStartTTS = useRef(getShouldAutoStartTTS());
  const sleepTimerActive = useRef<boolean>(false);
  const edgeTtsClientRef = useRef<EdgeTTSClient | null>(null);
  const audioSoundRef = useRef<Audio.Sound | null>(null);
  const preloadedSoundRef = useRef<{
    text: string;
    sound: Audio.Sound;
    filePath: string;
  } | null>(null);

  // Simplified timer cleanup
  const clearLocalTimers = useCallback(() => {
    if (sleepTimerTimeoutRef.current) {
      clearTimeout(sleepTimerTimeoutRef.current);
      sleepTimerTimeoutRef.current = null;
    }
  }, []);

  // Cleanup effect & Background Audio Setup
  useEffect(() => {
    const setAudioMode = async () => {
      try {
        // Configure audio session for background playback
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false, // We are not recording
          staysActiveInBackground: true, // *** THIS IS THE KEY FIX ***
          playsInSilentModeIOS: true, // Allow playback in silent mode on iOS
          interruptionModeIOS: InterruptionModeIOS.DoNotMix, // Stop other audio sources
          interruptionModeAndroid: InterruptionModeAndroid.DoNotMix, // Stop other audio sources
          shouldDuckAndroid: false, // Don't lower volume of other apps
          playThroughEarpieceAndroid: false, // Use the speaker
        });
      } catch (e) {}
    };

    setAudioMode(); // Call the function to set the audio mode
    shouldAutoStartTTS.current = getShouldAutoStartTTS();

    return () => {
      Speech.stop();
      edgeTtsClientRef.current?.close();
      unloadSound();
      unloadPreloadedSound();

      if (!shouldAutoStartTTS.current) {
        clearLocalTimers();
        setSleepTimerExpiry(null);
        sleepTimerActive.current = false;
        setShouldAutoStartTTS(false);
        const latestGeneralSettings =
          getMMKVObject<ChapterGeneralSettings>(CHAPTER_GENERAL_SETTINGS) ||
          initialChapterGeneralSettings;
        setChaptersReadCount(0, latestGeneralSettings);
      } else {
        clearLocalTimers();
      }
      // Optional: Reset audio mode on cleanup if needed, though usually not required
      // Consider if resetting is necessary based on app-wide audio needs
    };
  }, [clearLocalTimers]); // Keep dependencies minimal for setup effect

  // Define stopTTSAndClearState first as other callbacks depend on it
  const stopTTSAndClearState = useCallback(async () => {
    Speech.stop();
    edgeTtsClientRef.current?.close();
    await unloadSound();
    await unloadPreloadedSound();
    clearLocalTimers();
    setSleepTimerExpiry(null);
    sleepTimerActive.current = false;
    shouldAutoStartTTS.current = false;
    setShouldAutoStartTTS(false);
    const currentGeneralSettings =
      getMMKVObject<ChapterGeneralSettings>(CHAPTER_GENERAL_SETTINGS) ||
      initialChapterGeneralSettings;
    setChaptersReadCount(0, currentGeneralSettings);
  }, [clearLocalTimers]);

  // Setup sleep timer logic
  const setupSleepTimer = useCallback(() => {
    // delete old timer
    if (sleepTimerTimeoutRef.current) {
      clearTimeout(sleepTimerTimeoutRef.current);
      sleepTimerTimeoutRef.current = null;
    }

    const persistentExpiry = getSleepTimerExpiry();
    let expiryTime: number | null = null;
    let timeLeft: number | null = null;
    sleepTimerActive.current = false;

    if (persistentExpiry) {
      const now = Date.now();
      if (persistentExpiry > now) {
        expiryTime = persistentExpiry;
        timeLeft = expiryTime - now;
        sleepTimerActive.current = true;
      } else {
        setSleepTimerExpiry(null);
      }
    }

    if (!sleepTimerActive.current) {
      const currentGeneralSettings =
        getMMKVObject<ChapterGeneralSettings>(CHAPTER_GENERAL_SETTINGS) ||
        initialChapterGeneralSettings;

      if (
        currentGeneralSettings.TTSSleepTimer &&
        currentGeneralSettings.TTSSleepTimerDuration > 0
      ) {
        timeLeft = currentGeneralSettings.TTSSleepTimerDuration * 60 * 1000;
        expiryTime = Date.now() + timeLeft;
        setSleepTimerExpiry(expiryTime);
        sleepTimerActive.current = true;
      } else {
        if (persistentExpiry) {
          setSleepTimerExpiry(null);
        }
      }
    }

    if (timeLeft && timeLeft > 0) {
      if (sleepTimerTimeoutRef.current) {
        clearTimeout(sleepTimerTimeoutRef.current);
      }
      sleepTimerTimeoutRef.current = setTimeout(() => {
        console.log('TTS Sleep Timer expired.');

        // Call the unified stop function to handle state and cleanup
        stopTTSAndClearState();

        webViewRef.current?.injectJavaScript(`
          tts.reading = false;
          try { document.getElementById('TTS-Controller').firstElementChild.innerHTML = volumnIcon; } catch(e){}
        `);
      }, timeLeft);
    } else {
      if (sleepTimerActive.current) {
        sleepTimerActive.current = false;
        setSleepTimerExpiry(null);
      }
    }
  }, [webViewRef, stopTTSAndClearState]);

  // Effect runs when chapter changes
  useEffect(() => {
    if (chapterId) {
      shouldAutoStartTTS.current = getShouldAutoStartTTS();
      if (!shouldAutoStartTTS.current) {
        const currentGeneralSettings =
          getMMKVObject<ChapterGeneralSettings>(CHAPTER_GENERAL_SETTINGS) ||
          initialChapterGeneralSettings;
        setChaptersReadCount(0, currentGeneralSettings);
      }
    }
  }, [chapterId]);

  // Helper to unload the preloaded sound and delete its file
  const unloadPreloadedSound = async () => {
    if (preloadedSoundRef.current) {
      console.log('[TTS Hook] unloadPreloadedSound called.');
      console.log(
        'Unloading preloaded sound for:',
        preloadedSoundRef.current.text,
      );
      const { sound, filePath } = preloadedSoundRef.current;
      preloadedSoundRef.current = null; // Clear ref immediately
      try {
        await sound.unloadAsync();
      } catch (e) {
        console.error('Error unloading preloaded sound object:', e);
      }
      try {
        await FileSystem.deleteAsync(filePath, { idempotent: true });
        console.log('Deleted preloaded file:', filePath);
      } catch (e) {
        console.error('Error deleting preloaded file:', e);
      }
    }
  };

  // Modify unloadSound to also delete the file
  const unloadSound = async () => {
    if (audioSoundRef.current) {
      console.log('[TTS Hook] unloadSound called.');
      console.log('Unloading current sound');
      const soundToUnload = audioSoundRef.current;
      audioSoundRef.current = null; // Clear ref immediately
      let currentUri = null;
      try {
        const status = await soundToUnload.getStatusAsync();
        if (status.isLoaded) {
          currentUri = status.uri;
          await soundToUnload.unloadAsync();
        }
      } catch (unloadError) {
        console.error('Error unloading sound:', unloadError);
      }
      // Try deleting the associated file if it looks like one of ours
      if (
        currentUri &&
        currentUri.startsWith(FileSystem.cacheDirectory + 'tts_')
      ) {
        try {
          await FileSystem.deleteAsync(currentUri, { idempotent: true });
          console.log('Deleted current sound file:', currentUri);
        } catch (e) {
          console.error('Error deleting current sound file:', e);
        }
      }
    }
  };

  // Modified handleTTSComplete
  const handleTTSComplete = useCallback(async () => {
    await unloadSound();
    const currentGeneralSettings =
      getMMKVObject<ChapterGeneralSettings>(CHAPTER_GENERAL_SETTINGS) ||
      initialChapterGeneralSettings;

    if (currentGeneralSettings.TTSAutoNextChapter && nextChapter) {
      let navigate = true;

      if (currentGeneralSettings.TTSReadMultipleChapters) {
        const currentCount = getChaptersReadCount(currentGeneralSettings);
        const newCount = currentCount + 1;

        if (newCount >= currentGeneralSettings.TTSReadChaptersCount) {
          // Limit reached, stop everything using the unified function
          stopTTSAndClearState();
          navigate = false;

          webViewRef.current?.injectJavaScript(`
            tts.reading = false;
            try {
                const controller = document.getElementById('TTS-Controller');
                if (controller) { controller.firstElementChild.innerHTML = volumnIcon; }
            } catch(e){}
          `);
        } else {
          setChaptersReadCount(newCount, currentGeneralSettings);
        }
      }

      if (navigate) {
        Speech.stop();
        shouldAutoStartTTS.current = true;
        setShouldAutoStartTTS(true);
        clearLocalTimers();
        setTimeout(() => navigateChapter('NEXT'), 150);
      }
    } else {
      // Chapter finished, but not auto-navigating or auto-next is off.
      // Stop and clear state.
      stopTTSAndClearState();

      webViewRef.current?.injectJavaScript(`
          tts.reading = false;
          try {
              const controller = document.getElementById('TTS-Controller');
              if (controller) { controller.firstElementChild.innerHTML = volumnIcon; }
          } catch(e){}
      `);
    }
  }, [
    nextChapter,
    navigateChapter,
    clearLocalTimers,
    webViewRef,
    stopTTSAndClearState,
  ]);

  // Inject TTS patching logic - Simplified version
  const injectTTSLogic = useCallback(() => {
    webViewRef.current?.injectJavaScript(`
      console.log("[TTS WebView] Initializing TTS functionality");
      if (typeof tts !== 'undefined' && !tts._patched) {
        console.log("[TTS WebView] Found TTS object, patching methods");
        
        tts._originalStop = tts.stop;
        tts.stop = function(reason) {
          reader.post({ type: 'stop-speak', data: reason || 'manual' });
          this.currentElement?.classList?.remove('highlight');
          this.prevElement = null;
          this.currentElement = reader.chapterElement;
          this.started = false;
          this.reading = false;
        };

        tts._originalNext = tts.next;
        tts.next = function() {
          try {
            console.log("[TTS] next called");
            
            // Clean up previous node
            this.currentElement?.classList?.remove('highlight');
            
            if (this.findNextTextNode()) {
              // Highlight current node
              this.currentElement.classList.add('highlight');
              
              this.reading = true;
              console.log("[TTS] Speaking text:", this.currentElement.textContent?.trim().substring(0, 30));
              this.speak();
              return true;
            } else {
              console.log("[TTS] No more nodes found");
              this.reading = false;
              this.stop('chapter_end_auto_transition');
              try { document.getElementById('TTS-Controller').firstElementChild.innerHTML = volumnIcon; } catch(e){}
              reader.post({ type: 'tts-chapter-complete' });
              return false;
            }
          } catch (e) {
            console.error('[TTS WV Error] next():', e);
            this.stop('error');
            return false;
          }
        };

        tts._originalPause = tts.pause;
        tts.pause = function() {
          this.reading = false;
          reader.post({ type: 'stop-speak', data: 'pause' });
        };

        tts._originalResume = tts.resume;
        tts.resume = function() {
          if (!this.reading) {
            if (this.currentElement && this.currentElement.id !== 'LNReader-chapter') {
              this.speak();
              this.reading = true;
            } else {
              this.next();
            }
          }
        };

        tts._patched = true;
      }

      function checkDOMAndRequestAutoStart() {
        if (document.readyState === 'complete' && typeof tts !== 'undefined' && reader.chapterElement) {
          reader.post({ type: 'tts-check-auto-start' });
        } else {
          setTimeout(checkDOMAndRequestAutoStart, 200);
        }
      }
      checkDOMAndRequestAutoStart();

      true;
    `);
  }, [webViewRef, stopTTSAndClearState]);

  // Simplified processTTSMessage with cleaner Edge TTS handling
  const processTTSMessage = useCallback(
    async (event: WebViewPostEvent): Promise<boolean> => {
      const currentGeneralSettings =
        getMMKVObject<ChapterGeneralSettings>(CHAPTER_GENERAL_SETTINGS) ||
        initialChapterGeneralSettings;
      const currentReaderSettings =
        getMMKVObject<ChapterReaderSettings>(CHAPTER_READER_SETTINGS) ||
        initialChapterReaderSettings;
      const { ttsProvider = 'System', tts } = currentReaderSettings;

      switch (event.type) {
        case 'preload-speak':
          // We'll keep preloading for Edge TTS but simplify it
          if (
            typeof event.data === 'string' &&
            event.data.trim() &&
            ttsProvider === 'Edge' &&
            tts?.voice?.identifier
          ) {
            await unloadPreloadedSound();
            try {
              if (!edgeTtsClientRef.current) {
                edgeTtsClientRef.current = new EdgeTTSClient(true);
              }

              const client = edgeTtsClientRef.current;
              const textToPreload = event.data;
              console.log('Received preload request for:', textToPreload);

              // Sanitize text to avoid issues with special characters
              const sanitizedText = sanitizeTextForEdgeTTS(textToPreload);

              await client.setMetadata(
                tts.voice.identifier,
                OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
              );

              const prosodyOptions = {
                rate: tts.rate || 1.0,
                pitch: tts.pitch ? `${(tts.pitch - 1) * 100}%` : '+0%',
                volume: 100.0,
              };

              const tempFilePath =
                FileSystem.cacheDirectory + `tts_preload_${Date.now()}.mp3`;
              const audioChunks: Uint8Array[] = [];

              // Use the same retry mechanism we added to the speak handler
              let retryCount = 0;
              const maxRetries = 2;

              while (retryCount <= maxRetries) {
                try {
                  const ttsStream = client.toStream(
                    sanitizedText,
                    prosodyOptions,
                  );

                  await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                      reject(new Error('TTS preload request timed out'));
                    }, 15000);

                    ttsStream.on('data', (chunk: Uint8Array) =>
                      audioChunks.push(chunk),
                    );
                    ttsStream.on('end', async () => {
                      clearTimeout(timeout);
                      try {
                        const totalLength = audioChunks.reduce(
                          (acc, val) => acc + val.length,
                          0,
                        );
                        const concatenatedAudio = new Uint8Array(totalLength);
                        let offset = 0;
                        for (const chunk of audioChunks) {
                          concatenatedAudio.set(chunk, offset);
                          offset += chunk.length;
                        }
                        const base64Data =
                          uint8ArrayToBase64(concatenatedAudio);
                        await FileSystem.writeAsStringAsync(
                          tempFilePath,
                          base64Data,
                          { encoding: FileSystem.EncodingType.Base64 },
                        );
                        console.log(
                          'Preload stream finished, file written:',
                          tempFilePath,
                        );
                        resolve();
                      } catch (error) {
                        reject(error);
                      }
                    });
                    ttsStream.on('close', () => {
                      clearTimeout(timeout);
                      reject(new Error('WebSocket closed during preload'));
                    });
                  });

                  // Load the sound but DONT play
                  const { sound: preloadedSound } =
                    await Audio.Sound.createAsync(
                      { uri: tempFilePath },
                      { shouldPlay: false },
                    );

                  // Store the preloaded sound and its text
                  preloadedSoundRef.current = {
                    text: textToPreload,
                    sound: preloadedSound,
                    filePath: tempFilePath,
                  };

                  console.log(
                    'Sound preloaded successfully for:',
                    textToPreload,
                  );
                  break;
                } catch (error) {
                  retryCount++;
                  if (retryCount > maxRetries) {
                    throw error;
                  }
                  console.log(
                    `EdgeTTS preload attempt ${retryCount} failed, retrying...`,
                  );
                  client.close();
                  edgeTtsClientRef.current = new EdgeTTSClient(true);
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              }
            } catch (error) {
              console.error('EdgeTTS Preload Error:', error);
              await unloadPreloadedSound();
            }
          }
          return true;

        case 'speak':
          if (typeof event.data === 'string' && event.data.trim()) {
            setupSleepTimer();

            if (
              sleepTimerActive.current ||
              !currentGeneralSettings.TTSSleepTimer
            ) {
              Speech.stop();
              await unloadSound();

              const textToSpeak = event.data;
              console.log(
                `[TTS Hook] Received speak request for [${ttsProvider}]:`,
                textToSpeak.substring(0, 50) + '...', // Log truncated text
              );

              // Route based on provider
              if (ttsProvider === 'Edge' && tts?.voice?.identifier) {
                console.log('[TTS Hook] Using Edge TTS provider.');
                // Simple Edge TTS implementation
                try {
                  // Check if we have this text already preloaded
                  if (
                    preloadedSoundRef.current &&
                    preloadedSoundRef.current.text === textToSpeak
                  ) {
                    console.log('Using preloaded sound for:', textToSpeak);
                    // Move preloaded sound to current audio ref
                    audioSoundRef.current = preloadedSoundRef.current.sound;
                    preloadedSoundRef.current = null; // Clear the reference

                    // Set up a listener for completion
                    audioSoundRef.current.setOnPlaybackStatusUpdate(status => {
                      if (status.isLoaded && status.didJustFinish) {
                        // Call next on the webview
                        webViewRef.current?.injectJavaScript('tts.next()');
                        // Clean up
                        unloadSound();
                      }
                    });

                    // Start playback
                    console.log('[TTS Hook] Playing preloaded Edge TTS sound.');
                    await audioSoundRef.current.playAsync();
                    return true;
                  } else {
                    console.log(
                      '[TTS Hook] No preloaded sound found, fetching Edge TTS audio.',
                    );
                  }

                  await unloadPreloadedSound(); // Clean up any preloaded audio

                  if (!edgeTtsClientRef.current) {
                    edgeTtsClientRef.current = new EdgeTTSClient(true);
                  }

                  const client = edgeTtsClientRef.current;
                  await client.setMetadata(
                    tts.voice.identifier,
                    OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
                  );

                  // Sanitize text to avoid issues with special characters
                  const sanitizedText = sanitizeTextForEdgeTTS(textToSpeak);

                  const prosodyOptions = {
                    rate: tts.rate || 1.0,
                    pitch: tts.pitch ? `${(tts.pitch - 1) * 100}%` : '+0%',
                    volume: 100.0,
                  };

                  const tempFilePath =
                    FileSystem.cacheDirectory + `tts_${Date.now()}.mp3`;
                  const audioChunks: Uint8Array[] = [];

                  // Try with retries if needed
                  let retryCount = 0;
                  const maxRetries = 2;

                  while (retryCount <= maxRetries) {
                    try {
                      const ttsStream = client.toStream(
                        sanitizedText,
                        prosodyOptions,
                      );

                      await new Promise<void>((resolve, reject) => {
                        const timeout = setTimeout(() => {
                          reject(new Error('TTS request timed out'));
                        }, 15000); // 15 second timeout

                        ttsStream.on('data', (chunk: Uint8Array) =>
                          audioChunks.push(chunk),
                        );
                        ttsStream.on('end', async () => {
                          clearTimeout(timeout);
                          try {
                            const totalLength = audioChunks.reduce(
                              (acc, val) => acc + val.length,
                              0,
                            );
                            const concatenatedAudio = new Uint8Array(
                              totalLength,
                            );
                            let offset = 0;
                            for (const chunk of audioChunks) {
                              concatenatedAudio.set(chunk, offset);
                              offset += chunk.length;
                            }
                            const base64Data =
                              uint8ArrayToBase64(concatenatedAudio);
                            await FileSystem.writeAsStringAsync(
                              tempFilePath,
                              base64Data,
                              { encoding: FileSystem.EncodingType.Base64 },
                            );
                            resolve();
                          } catch (error) {
                            reject(error);
                          }
                        });
                        ttsStream.on('close', () => {
                          clearTimeout(timeout);
                          reject(new Error('WebSocket closed'));
                        });
                      });

                      // If we got here, success!
                      break;
                    } catch (error) {
                      retryCount++;
                      if (retryCount > maxRetries) {
                        throw error; // Rethrow if we've exhausted retries
                      }
                      console.log(
                        `EdgeTTS attempt ${retryCount} failed, retrying...`,
                      );
                      // Close old connection and create new one
                      client.close();
                      edgeTtsClientRef.current = new EdgeTTSClient(true);
                      await new Promise(resolve => setTimeout(resolve, 500)); // Wait briefly before retry
                    }
                  }

                  // Create and play the audio
                  const { sound } = await Audio.Sound.createAsync(
                    { uri: tempFilePath },
                    { shouldPlay: true }, // Play immediately
                  );
                  console.log('[TTS Hook] Edge TTS sound created and playing.');

                  audioSoundRef.current = sound;

                  // Set up a listener for completion - SIMPLIFIED
                  sound.setOnPlaybackStatusUpdate(status => {
                    if (!status.isLoaded) {
                      // If the status update indicates an error, handle it.
                      // 'status' type is AVPlaybackStatusError when !isLoaded and error exists
                      if (status.error) {
                        console.error(
                          '[TTS Hook] Edge Playback Error (not loaded):',
                          status.error,
                        );
                        webViewRef.current?.injectJavaScript(
                          'tts.stop("error")',
                        );
                        unloadSound(); // Unload on error
                      }
                      // If it's not loaded but not an error, it might be unloading, ignore or log.
                      return;
                    }

                    // If loaded, status type is AVPlaybackStatusSuccess
                    if (status.didJustFinish) {
                      console.log('[TTS Hook] Edge TTS playback finished.');
                      webViewRef.current?.injectJavaScript('tts.next()');
                      unloadSound(); // Unload after finishing
                    }

                    // Note: AVPlaybackStatusSuccess (when status.isLoaded is true) does not have an 'error' property.
                    // Errors during playback while loaded might manifest differently,
                    // potentially stopping playback or changing state without 'didJustFinish'.
                    // This simplified check focuses on completion and initial load errors.
                  });
                } catch (error) {
                  console.error('[TTS Hook] EdgeTTS Speak Error:', error); // Log specific error
                  // If Edge TTS fails, try falling back to system TTS
                  try {
                    console.log(
                      '[TTS Hook] Falling back to System TTS due to Edge error.',
                    );
                    Speech.speak(textToSpeak, {
                      onDone: () => {
                        console.log('[TTS Hook] System TTS fallback finished.');
                        webViewRef.current?.injectJavaScript('tts.next()');
                      },
                      onError: error => {
                        console.error(
                          '[TTS Hook] System TTS fallback Error:',
                          error,
                        );
                        webViewRef.current?.injectJavaScript(
                          'tts.stop("error")',
                        );
                      },
                      pitch: tts?.pitch || 1,
                      rate: tts?.rate || 1,
                    });
                  } catch (fallbackError) {
                    console.error(
                      '[TTS Hook] Fallback System TTS also failed:',
                      fallbackError,
                    );
                    webViewRef.current?.injectJavaScript('tts.stop("error")');
                  }
                }
              } else {
                console.log('[TTS Hook] Using System TTS provider.');
                // System TTS - simplified approach like the original
                Speech.speak(textToSpeak, {
                  onDone: () => {
                    console.log('[TTS Hook] System TTS finished.');
                    webViewRef.current?.injectJavaScript('tts.next()');
                  },
                  onError: error => {
                    console.error('[TTS Hook] System Speech Error:', error);
                    webViewRef.current?.injectJavaScript('tts.stop("error")');
                  },
                  voice: tts?.voice?.identifier,
                  pitch: tts?.pitch || 1,
                  rate: tts?.rate || 1,
                });
              } // End of if/else for ttsProvider
            } else {
              // If sleep timer is NOT active AND sleep timer is enabled
              webViewRef.current?.injectJavaScript('tts.stop("timer_expired")');
            }
          } else {
            // If event.data is empty or not a string
            // Empty speak event, just advance
            webViewRef.current?.injectJavaScript('tts.next()');
          }
          return true; // End of case 'speak'

        case 'stop-speak':
          Speech.stop();
          await unloadSound();
          await unloadPreloadedSound();
          const reason = event.data as string | undefined;

          if (reason === 'pause') {
            // Pause: Do nothing extra
          } else if (
            reason === 'auto_transition' ||
            reason === 'chapter_end_auto_transition'
          ) {
            clearLocalTimers();
          } else {
            clearLocalTimers();
            setSleepTimerExpiry(null);
            sleepTimerActive.current = false;
            if (
              reason !== 'timer_expired' &&
              reason !== 'timer_expired_on_check'
            ) {
              shouldAutoStartTTS.current = false;
              setShouldAutoStartTTS(false);
            }
            const latestGeneralSettings =
              getMMKVObject<ChapterGeneralSettings>(CHAPTER_GENERAL_SETTINGS) ||
              initialChapterGeneralSettings;
            setChaptersReadCount(0, latestGeneralSettings);
          }
          return true;

        case 'tts-check-auto-start':
          const shouldStart = shouldAutoStartTTS.current;
          shouldAutoStartTTS.current = false;

          if (shouldStart) {
            setupSleepTimer();
            if (
              sleepTimerActive.current ||
              !currentGeneralSettings.TTSSleepTimer
            ) {
              webViewRef.current?.injectJavaScript(`
                if (typeof tts !== 'undefined' && !tts.reading) {
                  tts.stop('auto_transition');
                  tts.currentElement = reader.chapterElement;
                  tts.prevElement = null;
                  tts.started = false;
                  tts.reading = false;
                  setTimeout(() => {
                    tts.next();
                    try { document.getElementById('TTS-Controller').firstElementChild.innerHTML = pauseIcon; } catch(e){}
                    reader.post({ type: 'tts-auto-start-success' });
                  }, 100);
                }
              `);
            } else {
              webViewRef.current?.injectJavaScript(`
                if(typeof tts !== 'undefined' && !tts.reading){
                  try { document.getElementById('TTS-Controller').firstElementChild.innerHTML = volumnIcon; } catch(e){}
                }
              `);
            }
          }
          return true;

        case 'tts-chapter-complete':
          handleTTSComplete();
          return true;

        case 'tts-auto-start-success':
          return true;

        default:
          return false;
      }
    },
    [setupSleepTimer, handleTTSComplete, webViewRef, stopTTSAndClearState],
  );

  return { injectTTSLogic, processTTSMessage, stopTTSAndClearState };
};
