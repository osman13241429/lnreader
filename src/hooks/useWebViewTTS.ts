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

// Type definitions (could be moved to a types file later)
type WebViewPostEvent = {
  type: string;
  data?: string | number | { [key: string]: string | number } | null;
};

// Define the return type for the hook
interface UseWebViewTTSResult {
  injectTTSLogic: () => void;
  processTTSMessage: (event: WebViewPostEvent) => boolean;
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

  // Simplified timer cleanup
  const clearLocalTimers = useCallback(() => {
    if (sleepTimerTimeoutRef.current) {
      clearTimeout(sleepTimerTimeoutRef.current);
      sleepTimerTimeoutRef.current = null;
    }
  }, []);

  // Cleanup effect
  useEffect(() => {
    shouldAutoStartTTS.current = getShouldAutoStartTTS();

    return () => {
      Speech.stop();

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
    };
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
        Speech.stop();
        setSleepTimerExpiry(null);
        sleepTimerActive.current = false;
        shouldAutoStartTTS.current = false;
        setShouldAutoStartTTS(false);
        const latestGeneralSettings =
          getMMKVObject<ChapterGeneralSettings>(CHAPTER_GENERAL_SETTINGS) ||
          initialChapterGeneralSettings;
        setChaptersReadCount(0, latestGeneralSettings);

        webViewRef.current?.injectJavaScript(`
          tts.reading = false;
          tts.stop('timer_expired');
          try { document.getElementById('TTS-Controller').firstElementChild.innerHTML = volumnIcon; } catch(e){}
        `);
      }, timeLeft);
    } else {
      if (sleepTimerActive.current) {
        sleepTimerActive.current = false;
        setSleepTimerExpiry(null);
      }
    }
  }, [webViewRef]);

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

  // Handle TTS completion
  const handleTTSComplete = useCallback(() => {
    const currentGeneralSettings =
      getMMKVObject<ChapterGeneralSettings>(CHAPTER_GENERAL_SETTINGS) ||
      initialChapterGeneralSettings;

    if (currentGeneralSettings.TTSAutoNextChapter && nextChapter) {
      let navigate = true;

      if (currentGeneralSettings.TTSReadMultipleChapters) {
        const currentCount = getChaptersReadCount(currentGeneralSettings);
        const newCount = currentCount + 1;

        if (newCount >= currentGeneralSettings.TTSReadChaptersCount) {
          Speech.stop();
          clearLocalTimers();
          setSleepTimerExpiry(null);
          sleepTimerActive.current = false;
          shouldAutoStartTTS.current = false;
          setShouldAutoStartTTS(false);
          setChaptersReadCount(0, currentGeneralSettings);
          navigate = false;

          webViewRef.current?.injectJavaScript(`
            tts.reading = false;
            try { document.getElementById('TTS-Controller').firstElementChild.innerHTML = volumnIcon; } catch(e){}
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
      Speech.stop();
      clearLocalTimers();
      setSleepTimerExpiry(null);
      sleepTimerActive.current = false;
      shouldAutoStartTTS.current = false;
      setShouldAutoStartTTS(false);
      const latestGeneralSettings =
        getMMKVObject<ChapterGeneralSettings>(CHAPTER_GENERAL_SETTINGS) ||
        initialChapterGeneralSettings;
      setChaptersReadCount(0, latestGeneralSettings);

      webViewRef.current?.injectJavaScript(`
          tts.reading = false;
          try { document.getElementById('TTS-Controller').firstElementChild.innerHTML = volumnIcon; } catch(e){}
      `);
    }
  }, [nextChapter, navigateChapter, clearLocalTimers, webViewRef]);

  // Inject TTS patching logic
  const injectTTSLogic = useCallback(() => {
    webViewRef.current?.injectJavaScript(`
      if (typeof tts !== 'undefined' && !tts._patched) {
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
            this.currentElement?.classList?.remove('highlight');
            if (this.findNextTextNode()) {
              this.reading = true;
              this.speak();
            } else {
              this.reading = false;
              this.stop('chapter_end_auto_transition');
              try { document.getElementById('TTS-Controller').firstElementChild.innerHTML = volumnIcon; } catch(e){}
              reader.post({ type: 'tts-chapter-complete' });
            }
          } catch (e) {
            console.error('[TTS WV Error] next():', e);
            this.stop('error');
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
  }, [webViewRef]);

  // Process TTS-related messages
  const processTTSMessage = useCallback(
    (event: WebViewPostEvent): boolean => {
      const currentGeneralSettings =
        getMMKVObject<ChapterGeneralSettings>(CHAPTER_GENERAL_SETTINGS) ||
        initialChapterGeneralSettings;
      const currentReaderSettings =
        getMMKVObject<ChapterReaderSettings>(CHAPTER_READER_SETTINGS) ||
        initialChapterReaderSettings;

      switch (event.type) {
        case 'speak':
          if (typeof event.data === 'string' && event.data.trim()) {
            setupSleepTimer();

            if (
              sleepTimerActive.current ||
              !currentGeneralSettings.TTSSleepTimer
            ) {
              Speech.speak(event.data, {
                onDone: () => {
                  if (webViewRef.current) {
                    webViewRef.current.injectJavaScript('tts.next?.()');
                  }
                },
                onError: error => {
                  console.error('Speech Error:', error);
                  webViewRef.current?.injectJavaScript('tts.stop("error");');
                },
                voice: currentReaderSettings.tts?.voice?.identifier,
                pitch: currentReaderSettings.tts?.pitch || 1,
                rate: currentReaderSettings.tts?.rate || 1,
              });
            } else {
              webViewRef.current?.injectJavaScript(
                'tts.stop("timer_expired");',
              );
            }
          } else {
            webViewRef.current?.injectJavaScript('tts.next?.()');
          }
          return true;

        case 'stop-speak':
          Speech.stop();
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
                    } else if (typeof tts !== 'undefined' && tts.reading) {
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
    [webViewRef, setupSleepTimer, handleTTSComplete, clearLocalTimers],
  );

  // Function to explicitly stop TTS and clear all associated state
  const stopTTSAndClearState = useCallback(() => {
    Speech.stop();
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

  return { injectTTSLogic, processTTSMessage, stopTTSAndClearState };
};
