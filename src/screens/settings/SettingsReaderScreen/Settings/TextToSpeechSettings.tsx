import { IconButtonV2, List, SwitchItem } from '@components';
import {
  useChapterGeneralSettings,
  useChapterReaderSettings,
  useTheme,
} from '@hooks/persisted';
import React, { useEffect, useState } from 'react';
import VoicePickerModal from '../Modals/VoicePickerModal';
import LocalePickerModal from '../Modals/LocalePickerModal';
import EdgeVoicePickerModal from '../Modals/EdgeVoicePickerModal';
import { useBoolean } from '@hooks';
import { Portal } from 'react-native-paper';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import Slider from '@react-native-community/slider';
import { Voice, VoiceQuality } from 'expo-speech';
import Switch from '@components/Switch/Switch';
import {
  EdgeTTSClient,
  Voice as EdgeVoice,
} from '@services/tts/EdgeTTSProvider';
import { RadioButton as PaperRadioButton } from 'react-native-paper';

// Move interface here to share with EdgeVoicePickerModal
export interface ProcessedEdgeVoice extends EdgeVoice {
  identifier: string; // Add identifier for consistency
}

export default function TextToSpeechSettings() {
  const theme = useTheme();
  const {
    tts,
    ttsProvider = 'System',
    edgeTTSLocale,
    setChapterReaderSettings,
  } = useChapterReaderSettings();
  const {
    TTSEnable = false,
    TTSAutoNextChapter = false,
    TTSSleepTimer = false,
    TTSSleepTimerDuration = 30,
    TTSReadMultipleChapters = false,
    TTSReadChaptersCount = 1,
    setChapterGeneralSettings,
  } = useChapterGeneralSettings();

  const {
    value: systemVoiceModalVisible,
    setTrue: showSystemVoiceModal,
    setFalse: hideSystemVoiceModal,
  } = useBoolean();

  const {
    value: localeModalVisible,
    setTrue: showLocaleModal,
    setFalse: hideLocaleModal,
  } = useBoolean();

  const {
    value: edgeVoiceModalVisible,
    setTrue: showEdgeVoiceModal,
    setFalse: hideEdgeVoiceModal,
  } = useBoolean();

  // State for Edge TTS voices and locales
  const [edgeVoices, setEdgeVoices] = useState<ProcessedEdgeVoice[]>([]);
  const [edgeLocales, setEdgeLocales] = useState<string[]>([]);
  const [selectedEdgeLocale, setSelectedEdgeLocale] = useState<string | null>(
    edgeTTSLocale || null,
  );
  const [isLoadingEdgeVoices, setIsLoadingEdgeVoices] = useState(false);

  // Function to fetch and process Edge voices
  const fetchEdgeVoices = async () => {
    setIsLoadingEdgeVoices(true);
    try {
      const client = new EdgeTTSClient();
      const voices = await client.getVoices();
      const processedVoices = voices.map(v => ({
        ...v,
        identifier: v.ShortName, // Use ShortName as unique ID
      }));
      processedVoices.sort(
        (a, b) =>
          a.Locale.localeCompare(b.Locale) ||
          a.FriendlyName.localeCompare(b.FriendlyName),
      );
      setEdgeVoices(processedVoices);

      // Extract unique locales
      const locales = [...new Set(processedVoices.map(v => v.Locale))].sort();
      setEdgeLocales(locales);

      // Set default locale if none selected or if current voice's locale exists
      if (!selectedEdgeLocale || !locales.includes(selectedEdgeLocale)) {
        const currentVoiceLocale = processedVoices.find(
          v => v.identifier === tts?.voice?.identifier,
        )?.Locale;
        const localeToUse =
          currentVoiceLocale || edgeTTSLocale || locales[0] || null;
        setSelectedEdgeLocale(localeToUse);

        // If we had to choose a locale here, persist it
        if (localeToUse && localeToUse !== edgeTTSLocale) {
          setChapterReaderSettings({
            edgeTTSLocale: localeToUse,
          });
        }
      }
    } catch (error) {
      console.error('Error fetching Edge TTS voices:', error);
      setEdgeVoices([]);
      setEdgeLocales([]);
    } finally {
      setIsLoadingEdgeVoices(false);
    }
  };

  // Fetch Edge voices when provider is Edge or changes to Edge
  useEffect(() => {
    if (TTSEnable && ttsProvider === 'Edge') {
      fetchEdgeVoices();
    } else {
      // Clear edge data if not Edge provider or TTS disabled
      setEdgeVoices([]);
      setEdgeLocales([]);
      // Don't clear selectedEdgeLocale here so we keep the value when toggling TTS
    }
  }, [ttsProvider, TTSEnable, tts?.voice?.identifier, edgeTTSLocale]); // Add edgeTTSLocale to deps

  // Filter voices based on selected locale
  const filteredEdgeVoices = edgeVoices.filter(
    v => v.Locale === selectedEdgeLocale,
  );

  const handleProviderChange = (newProvider: 'System' | 'Edge') => {
    // Reset voice when provider changes
    setChapterReaderSettings({
      ttsProvider: newProvider,
      tts: { ...tts, voice: undefined }, // Reset voice
    });
    // Don't reset locale selection for a better UX when switching back
  };

  // Define styles inside the component to access theme
  const styles = StyleSheet.create({
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    label: {
      textAlign: 'center',
      fontSize: 16,
    },
    valueLabel: {
      textAlign: 'center',
      fontSize: 14,
      marginBottom: 8,
    },
    slider: {
      flex: 1,
      height: 40,
    },
    radioGroup: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    pickerContainer: {
      marginHorizontal: 16,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: theme.outline,
      borderRadius: 4,
    },
    picker: {
      height: 50,
    },
    pressableRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginRight: 16,
    },
    radioLabel: {
      marginLeft: 8,
      fontSize: 16,
    },
  });

  return (
    <>
      <View style={styles.row}>
        <List.SubHeader theme={theme}>Text to Speech</List.SubHeader>
        <View style={styles.row}>
          <Switch
            theme={theme}
            value={TTSEnable}
            onValueChange={() => {
              setChapterGeneralSettings({
                TTSEnable: !TTSEnable,
              });
            }}
          />
          <IconButtonV2
            name="reload"
            theme={theme}
            color={theme.primary}
            onPress={() => {
              setChapterReaderSettings({
                tts: {
                  pitch: 1,
                  rate: 1,
                  voice: { name: 'System', language: 'System' } as Voice,
                },
              });
            }}
          />
        </View>
      </View>
      {TTSEnable ? (
        <>
          {/* Provider Selection - Use PaperRadioButton directly */}
          <List.SubHeader theme={theme}>Provider</List.SubHeader>
          <View style={styles.radioGroup}>
            {/* System Device Option */}
            <Pressable
              onPress={() => handleProviderChange('System')}
              style={styles.pressableRow}
            >
              <PaperRadioButton
                value="System"
                status={ttsProvider === 'System' ? 'checked' : 'unchecked'}
                onPress={() => handleProviderChange('System')}
                color={theme.primary}
                uncheckedColor={theme.onSurfaceVariant}
              />
              <Text style={[styles.radioLabel, { color: theme.onSurface }]}>
                System Device
              </Text>
            </Pressable>
            {/* Edge Option */}
            <Pressable
              onPress={() => handleProviderChange('Edge')}
              style={styles.pressableRow}
            >
              <PaperRadioButton
                value="Edge"
                status={ttsProvider === 'Edge' ? 'checked' : 'unchecked'}
                onPress={() => handleProviderChange('Edge')}
                color={theme.primary}
                uncheckedColor={theme.onSurfaceVariant}
              />
              <Text style={[styles.radioLabel, { color: theme.onSurface }]}>
                Microsoft Edge Online
              </Text>
            </Pressable>
          </View>

          {/* Conditional Voice Settings based on Provider */}
          {ttsProvider === 'System' && (
            <List.Item
              title="System Voice"
              description={tts?.voice?.name || 'Default'}
              onPress={showSystemVoiceModal}
              theme={theme}
            />
          )}

          {ttsProvider === 'Edge' && (
            <>
              <List.SubHeader theme={theme}>Edge Voice</List.SubHeader>
              {/* Locale Picker Item */}
              <List.Item
                title="Language/Locale"
                description={selectedEdgeLocale || 'Select...'}
                onPress={showLocaleModal}
                theme={theme}
              />
              {/* Voice Name Picker Item (filtered by locale) */}
              <List.Item
                title="Voice Name"
                description={tts?.voice?.name || 'Select...'}
                onPress={showEdgeVoiceModal}
                theme={theme}
                disabled={!selectedEdgeLocale || isLoadingEdgeVoices}
              />
            </>
          )}

          {/* Rate and Pitch Sliders (Common) */}
          <List.Section>
            <Text style={[styles.label, { color: theme.onSurface }]}>
              Voice rate
            </Text>
            <Slider
              style={styles.slider}
              value={tts?.rate}
              minimumValue={0.1}
              maximumValue={5}
              step={0.1}
              minimumTrackTintColor={theme.primary}
              maximumTrackTintColor={theme.surfaceVariant}
              thumbTintColor={theme.primary}
              onSlidingComplete={value =>
                setChapterReaderSettings({ tts: { ...tts, rate: value } })
              }
            />
            <Text style={[styles.label, { color: theme.onSurface }]}>
              Voice pitch
            </Text>
            <Slider
              style={styles.slider}
              value={tts?.pitch}
              minimumValue={0.1}
              maximumValue={5}
              step={0.1}
              minimumTrackTintColor={theme.primary}
              maximumTrackTintColor={theme.surfaceVariant}
              thumbTintColor={theme.primary}
              onSlidingComplete={value =>
                setChapterReaderSettings({ tts: { ...tts, pitch: value } })
              }
            />
          </List.Section>

          {/* Auto Next Chapter Settings */}
          <List.Section>
            <List.SubHeader theme={theme}>
              Auto Chapter Navigation
            </List.SubHeader>
            <SwitchItem
              label={'Auto load next chapter'}
              description={
                'Automatically load the next chapter when TTS finishes reading'
              }
              theme={theme}
              value={TTSAutoNextChapter}
              onPress={() => {
                setChapterGeneralSettings({
                  TTSAutoNextChapter: !TTSAutoNextChapter,
                });
              }}
            />

            {/* Read Multiple Chapters */}
            <SwitchItem
              label={'Read multiple chapters'}
              description={`Stop after reading ${TTSReadChaptersCount} chapters`}
              theme={theme}
              value={TTSReadMultipleChapters}
              onPress={() => {
                setChapterGeneralSettings({
                  TTSReadMultipleChapters: !TTSReadMultipleChapters,
                });
              }}
            />

            {TTSReadMultipleChapters && (
              <>
                <Text
                  style={[
                    styles.label,
                    { color: theme.onSurface, marginTop: 8 },
                  ]}
                >
                  Number of chapters to read
                </Text>
                <Slider
                  style={styles.slider}
                  value={TTSReadChaptersCount}
                  minimumValue={1}
                  maximumValue={10}
                  step={1}
                  minimumTrackTintColor={theme.primary}
                  maximumTrackTintColor={theme.surfaceVariant}
                  thumbTintColor={theme.primary}
                  onSlidingComplete={value =>
                    setChapterGeneralSettings({ TTSReadChaptersCount: value })
                  }
                />
                <Text style={[styles.valueLabel, { color: theme.onSurface }]}>
                  {TTSReadChaptersCount}{' '}
                  {TTSReadChaptersCount === 1 ? 'chapter' : 'chapters'}
                </Text>
              </>
            )}

            {/* Sleep Timer */}
            <SwitchItem
              label={'Sleep timer'}
              description={`Stop TTS after ${TTSSleepTimerDuration} minutes`}
              theme={theme}
              value={TTSSleepTimer}
              onPress={() => {
                setChapterGeneralSettings({
                  TTSSleepTimer: !TTSSleepTimer,
                });
              }}
            />

            {TTSSleepTimer && (
              <>
                <Text
                  style={[
                    styles.label,
                    { color: theme.onSurface, marginTop: 8 },
                  ]}
                >
                  Sleep timer duration (minutes)
                </Text>
                <Slider
                  style={styles.slider}
                  value={TTSSleepTimerDuration}
                  minimumValue={1}
                  maximumValue={120}
                  step={1}
                  minimumTrackTintColor={theme.primary}
                  maximumTrackTintColor={theme.surfaceVariant}
                  thumbTintColor={theme.primary}
                  onSlidingComplete={value =>
                    setChapterGeneralSettings({ TTSSleepTimerDuration: value })
                  }
                />
                <Text style={[styles.valueLabel, { color: theme.onSurface }]}>
                  {TTSSleepTimerDuration} minutes
                </Text>
              </>
            )}
          </List.Section>
        </>
      ) : null}
      <View style={{ height: 16 }} />

      {/* System Voice Modal */}
      <Portal>
        <VoicePickerModal
          visible={systemVoiceModalVisible}
          onDismiss={hideSystemVoiceModal}
        />
      </Portal>

      {/* Edge Locale Modal */}
      <Portal>
        <LocalePickerModal
          visible={localeModalVisible}
          onDismiss={hideLocaleModal}
          locales={edgeLocales}
          currentLocale={selectedEdgeLocale}
          onSelectLocale={locale => {
            setSelectedEdgeLocale(locale);
            // Store the selected locale in settings
            setChapterReaderSettings({
              edgeTTSLocale: locale,
              tts: { ...tts, voice: undefined }, // Reset voice when locale changes
            });
          }}
        />
      </Portal>

      {/* Edge Voice Modal */}
      <Portal>
        <EdgeVoicePickerModal
          visible={edgeVoiceModalVisible}
          onDismiss={hideEdgeVoiceModal}
          voices={filteredEdgeVoices}
          currentVoiceIdentifier={tts?.voice?.identifier}
          onSelectVoice={selectedVoice => {
            setChapterReaderSettings({
              tts: {
                ...tts,
                voice: {
                  identifier: selectedVoice.identifier,
                  name: selectedVoice.FriendlyName,
                  language: selectedVoice.Locale,
                  quality: VoiceQuality.Default,
                },
              },
            });
          }}
        />
      </Portal>
    </>
  );
}
