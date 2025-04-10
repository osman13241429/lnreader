import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import {
  Portal,
  Modal,
  overlay,
  TextInput,
  ActivityIndicator,
} from 'react-native-paper';
import { RadioButton } from '@components/RadioButton/RadioButton';

import { useChapterReaderSettings, useTheme } from '@hooks/persisted';
import { Voice, getAvailableVoicesAsync } from 'expo-speech';
import { FlashList } from '@shopify/flash-list';

interface VoicePickerModalProps {
  visible: boolean;
  onDismiss: () => void;
}

const VoicePickerModal: React.FC<VoicePickerModalProps> = ({
  onDismiss,
  visible,
}) => {
  const theme = useTheme();
  const [systemVoices, setSystemVoices] = useState<Voice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchedVoices, setSearchedVoices] = useState<Voice[]>([]);
  const [searchText, setSearchText] = useState('');
  const { setChapterReaderSettings, tts } = useChapterReaderSettings();

  useEffect(() => {
    if (visible) {
      setIsLoading(true);
      const fetchVoices = async () => {
        try {
          const systemVoicesResult = await getAvailableVoicesAsync();

          const processedSystemVoices = systemVoicesResult.map(v => ({
            ...v,
            identifier: v.identifier || v.name,
          }));
          processedSystemVoices.sort((a, b) => a.name.localeCompare(b.name));

          setSystemVoices(processedSystemVoices);
        } catch (error) {
          console.error('Error fetching System TTS voices:', error);
          setSystemVoices([]);
        } finally {
          setIsLoading(false);
        }
      };

      fetchVoices();
    }
  }, [visible]);

  useEffect(() => {
    if (searchText) {
      setSearchedVoices(
        systemVoices.filter(voice =>
          voice.name
            .toLocaleLowerCase()
            .includes(searchText.toLocaleLowerCase()),
        ),
      );
    } else {
      setSearchedVoices(systemVoices);
    }
  }, [searchText, systemVoices]);

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[
          styles.containerStyle,
          { backgroundColor: overlay(2, theme.surface) },
        ]}
      >
        <FlashList
          ListHeaderComponent={
            <TextInput
              mode="outlined"
              underlineColor={theme.outline}
              theme={{ colors: { ...theme } }}
              onChangeText={text => {
                setSearchText(text);
              }}
              value={searchText}
              placeholder="Search voice"
            />
          }
          ListHeaderComponentStyle={{ paddingHorizontal: 12 }}
          data={searchedVoices}
          extraData={tts?.voice?.identifier}
          renderItem={({ item }) => (
            <RadioButton
              status={
                item.identifier === tts?.voice?.identifier
                  ? 'checked'
                  : 'unchecked'
              }
              onPress={() => {
                setChapterReaderSettings({ tts: { ...tts, voice: item } });
                onDismiss();
              }}
              label={`${item.name} (${item.language})`}
              theme={theme}
            />
          )}
          keyExtractor={item => item.identifier || item.name || 'error-key'}
          estimatedItemSize={64}
          removeClippedSubviews={true}
          ListEmptyComponent={
            isLoading ? (
              <ActivityIndicator
                size={24}
                style={{ marginTop: 16 }}
                color={theme.primary}
              />
            ) : null
          }
        />
      </Modal>
    </Portal>
  );
};

export default VoicePickerModal;

const styles = StyleSheet.create({
  containerStyle: {
    paddingVertical: 24,
    margin: 20,
    borderRadius: 28,
    flex: 1,
  },
});
