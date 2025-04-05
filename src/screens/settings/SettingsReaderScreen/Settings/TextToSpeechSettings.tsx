import { IconButtonV2, List, SwitchItem } from '@components';
import {
  useChapterGeneralSettings,
  useChapterReaderSettings,
  useTheme,
} from '@hooks/persisted';
import React, { useEffect, useState } from 'react';
import VoicePickerModal from '../Modals/VoicePickerModal';
import { useBoolean } from '@hooks';
import { Portal } from 'react-native-paper';
import { StyleSheet, View, Text } from 'react-native';
import Slider from '@react-native-community/slider';
import { getAvailableVoicesAsync, Voice } from 'expo-speech';
import Switch from '@components/Switch/Switch';

export default function TextToSpeechSettings() {
  const theme = useTheme();
  const [voices, setVoices] = useState<Voice[]>([]);
  useEffect(() => {
    getAvailableVoicesAsync().then(res => {
      res.sort((a, b) => a.name.localeCompare(b.name));
      setVoices([{ name: 'System', language: 'System' } as Voice, ...res]);
    });
  }, []);

  const { tts, setChapterReaderSettings } = useChapterReaderSettings();
  const {
    TTSEnable = true,
    TTSAutoNextChapter = false,
    TTSSleepTimer = false,
    TTSSleepTimerDuration = 30,
    TTSReadMultipleChapters = false,
    TTSReadChaptersCount = 1,
    setChapterGeneralSettings,
  } = useChapterGeneralSettings();

  const {
    value: voiceModalVisible,
    setTrue: showVoiceModal,
    setFalse: hideVoiceModal,
  } = useBoolean();

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
          <List.Item
            title={'TTS voice'}
            description={tts?.voice?.name || 'System'}
            onPress={showVoiceModal}
            theme={theme}
          />
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
      <Portal>
        <VoicePickerModal
          visible={voiceModalVisible}
          onDismiss={hideVoiceModal}
          voices={voices}
        />
      </Portal>
    </>
  );
}

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
});
