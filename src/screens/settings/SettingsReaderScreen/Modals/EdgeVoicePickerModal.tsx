import React, { useEffect, useState } from 'react';
import { StyleSheet, Pressable, Text } from 'react-native';
import {
  Portal,
  Modal,
  overlay,
  TextInput,
  ActivityIndicator,
  RadioButton as PaperRadioButton,
} from 'react-native-paper';
import { useTheme } from '@hooks/persisted';
import { FlashList } from '@shopify/flash-list';
import { ProcessedEdgeVoice } from '../Settings/TextToSpeechSettings'; // Import from parent

// Define props for the Edge voice picker
interface EdgeVoicePickerModalProps {
  visible: boolean;
  onDismiss: () => void;
  voices: ProcessedEdgeVoice[]; // Expects pre-filtered voices for the selected locale
  currentVoiceIdentifier: string | undefined;
  onSelectVoice: (voice: ProcessedEdgeVoice) => void;
}

const EdgeVoicePickerModal: React.FC<EdgeVoicePickerModalProps> = ({
  visible,
  onDismiss,
  voices,
  currentVoiceIdentifier,
  onSelectVoice,
}) => {
  const theme = useTheme();
  const [searchedVoices, setSearchedVoices] = useState<ProcessedEdgeVoice[]>(
    [],
  );
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    if (searchText) {
      setSearchedVoices(
        voices.filter(voice =>
          voice.FriendlyName.toLowerCase().includes(searchText.toLowerCase()),
        ),
      );
    } else {
      setSearchedVoices(voices);
    }
  }, [searchText, voices]);

  // Reset search text when modal becomes visible or voices change
  useEffect(() => {
    if (visible) {
      setSearchText('');
    }
  }, [visible, voices]);

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
              onChangeText={setSearchText}
              value={searchText}
              placeholder="Search Voice Name"
              style={styles.searchbar}
            />
          }
          data={searchedVoices}
          extraData={currentVoiceIdentifier}
          renderItem={({ item }) => (
            <Pressable
              style={styles.pressableRow}
              onPress={() => {
                onSelectVoice(item);
                onDismiss();
              }}
              android_ripple={{ color: theme.rippleColor }}
            >
              <PaperRadioButton
                value={item.identifier}
                status={
                  item.identifier === currentVoiceIdentifier
                    ? 'checked'
                    : 'unchecked'
                }
                onPress={() => {
                  onSelectVoice(item);
                  onDismiss();
                }}
                color={theme.primary}
                uncheckedColor={theme.onSurfaceVariant}
              />
              <Text style={[styles.radioLabel, { color: theme.onSurface }]}>
                {item.FriendlyName}
              </Text>
            </Pressable>
          )}
          keyExtractor={item => item.identifier}
          estimatedItemSize={54} // Adjust as needed
          ListEmptyComponent={
            voices.length === 0 && searchText === '' ? ( // Show spinner only if initial list is empty
              <ActivityIndicator
                size={24}
                style={styles.activityIndicator}
                color={theme.primary}
              />
            ) : searchedVoices.length === 0 && searchText !== '' ? (
              <Text
                style={[styles.emptyText, { color: theme.onSurfaceVariant }]}
              >
                No voices found matching "{searchText}"
              </Text>
            ) : null
          }
        />
      </Modal>
    </Portal>
  );
};

export default EdgeVoicePickerModal;

// Use same styles as LocalePickerModal for consistency
const styles = StyleSheet.create({
  containerStyle: {
    paddingVertical: 24,
    margin: 20,
    borderRadius: 28,
    flex: 1,
  },
  searchbar: {
    marginHorizontal: 12,
    marginBottom: 8,
  },
  activityIndicator: {
    marginTop: 16,
  },
  pressableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  radioLabel: {
    marginLeft: 12,
    fontSize: 16,
  },
  emptyText: {
    marginTop: 16,
    textAlign: 'center',
  },
});
