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

interface LocalePickerModalProps {
  visible: boolean;
  onDismiss: () => void;
  locales: string[];
  currentLocale: string | null;
  onSelectLocale: (locale: string) => void;
}

// Basic mapping from locale code to country flag emoji
// Needs to be expanded for better coverage
const localeToFlag: { [key: string]: string } = {
  'af-ZA': '🇿🇦',
  'am-ET': '🇪🇹',
  'ar-AE': '🇦🇪',
  'ar-BH': '🇧🇭',
  'ar-DZ': '🇩🇿',
  'ar-EG': '🇪🇬',
  'ar-IQ': '🇮🇶',
  'ar-JO': '🇯🇴',
  'ar-KW': '🇰🇼',
  'ar-LB': '🇱🇧',
  'ar-LY': '🇱🇾',
  'ar-MA': '🇲🇦',
  'ar-OM': '🇴🇲',
  'ar-QA': '🇶🇦',
  'ar-SA': '🇸🇦',
  'ar-SY': '🇸🇾',
  'ar-TN': '🇹🇳',
  'ar-YE': '🇾🇪',
  'az-AZ': '🇦🇿',
  'bg-BG': '🇧🇬',
  'bn-BD': '🇧🇩',
  'bn-IN': '🇮🇳',
  'bs-BA': '🇧🇦',
  'ca-ES': '🇪🇸',
  'cs-CZ': '🇨🇿',
  'cy-GB': '🇬🇧',
  'da-DK': '🇩🇰',
  'de-AT': '🇦🇹',
  'de-CH': '🇨🇭',
  'de-DE': '🇩🇪',
  'el-GR': '🇬🇷',
  'en-AU': '🇦🇺',
  'en-CA': '🇨🇦',
  'en-GB': '🇬🇧',
  'en-HK': '🇭🇰',
  'en-IE': '🇮🇪',
  'en-IN': '🇮🇳',
  'en-KE': '🇰🇪',
  'en-NG': '🇳🇬',
  'en-NZ': '🇳🇿',
  'en-PH': '🇵🇭',
  'en-SG': '🇸🇬',
  'en-TZ': '🇹🇿',
  'en-US': '🇺🇸',
  'en-ZA': '🇿🇦',
  'es-AR': '🇦🇷',
  'es-BO': '🇧🇴',
  'es-CL': '🇨🇱',
  'es-CO': '🇨🇴',
  'es-CR': '🇨🇷',
  'es-DO': '🇩🇴',
  'es-EC': '🇪🇨',
  'es-ES': '🇪🇸',
  'es-GQ': '🇬🇶',
  'es-GT': '🇬🇹',
  'es-HN': '🇭🇳',
  'es-MX': '🇲🇽',
  'es-NI': '🇳🇮',
  'es-PA': '🇵🇦',
  'es-PE': '🇵🇪',
  'es-PR': '🇵🇷',
  'es-PY': '🇵🇾',
  'es-SV': '🇸🇻',
  'es-US': '🇺🇸',
  'es-UY': '🇺🇾',
  'es-VE': '🇻🇪',
  'et-EE': '🇪🇪',
  'eu-ES': '🇪🇸',
  'fa-IR': '🇮🇷',
  'fi-FI': '🇫🇮',
  'fil-PH': '��🇭',
  'fr-BE': '🇧🇪',
  'fr-CA': '🇨🇦',
  'fr-CH': '🇨🇭',
  'fr-FR': '🇫🇷',
  'ga-IE': '🇮🇪',
  'gl-ES': '🇪🇸',
  'gu-IN': '🇮🇳',
  'he-IL': '🇮🇱',
  'hi-IN': '🇮🇳',
  'hr-HR': '🇭🇷',
  'hu-HU': '🇭🇺',
  'hy-AM': '🇦🇲',
  'id-ID': '🇮🇩',
  'is-IS': '🇮🇸',
  'it-CH': '🇨🇭',
  'it-IT': '🇮🇹',
  'ja-JP': '🇯🇵',
  'jv-ID': '🇮🇩',
  'ka-GE': '🇬🇪',
  'kk-KZ': '🇰🇿',
  'km-KH': '🇰🇭',
  'kn-IN': '🇮🇳',
  'ko-KR': '🇰🇷',
  'lo-LA': '🇱🇦',
  'lt-LT': '🇱🇹',
  'lv-LV': '🇱🇻',
  'mk-MK': '🇲🇰',
  'ml-IN': '🇮🇳',
  'mn-MN': '🇲🇳',
  'mr-IN': '🇮🇳',
  'ms-MY': '🇲🇾',
  'mt-MT': '🇲🇹',
  'my-MM': '🇲🇲',
  'nb-NO': '🇳🇴',
  'ne-NP': '🇳🇵',
  'nl-BE': '🇧🇪',
  'nl-NL': '🇳🇱',
  'pa-IN': '🇮🇳',
  'pl-PL': '🇵🇱',
  'ps-AF': '🇦🇫',
  'pt-BR': '🇧🇷',
  'pt-PT': '🇵🇹',
  'ro-RO': '🇷🇴',
  'ru-RU': '🇷🇺',
  'si-LK': '🇱🇰',
  'sk-SK': '🇸🇰',
  'sl-SI': '🇸🇮',
  'so-SO': '🇸🇴',
  'sq-AL': '🇦🇱',
  'sr-RS': '🇷🇸',
  'su-ID': '🇮🇩',
  'sv-SE': '🇸🇪',
  'sw-KE': '🇰🇪',
  'sw-TZ': '🇹🇿',
  'ta-IN': '🇮🇳',
  'ta-LK': '🇱🇰',
  'ta-MY': '🇲🇾',
  'ta-SG': '🇸🇬',
  'te-IN': '🇮🇳',
  'th-TH': '🇹🇭',
  'tr-TR': '🇹🇷',
  'uk-UA': '🇺🇦',
  'ur-IN': '🇮🇳',
  'ur-PK': '🇵🇰',
  'uz-UZ': '🇺🇿',
  'vi-VN': '🇻🇳',
  'zh-CN': '🇨🇳',
  'zh-HK': '🇭🇰',
  'zh-TW': '🇹🇼',
  'zu-ZA': '🇿🇦',
  // Add more as needed
};

const LocalePickerModal: React.FC<LocalePickerModalProps> = ({
  visible,
  onDismiss,
  locales,
  currentLocale,
  onSelectLocale,
}) => {
  const theme = useTheme();
  const [searchedLocales, setSearchedLocales] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    if (searchText) {
      setSearchedLocales(
        locales.filter(locale =>
          locale.toLowerCase().includes(searchText.toLowerCase()),
        ),
      );
    } else {
      setSearchedLocales(locales);
    }
  }, [searchText, locales]);

  // Reset search text when modal becomes visible
  useEffect(() => {
    if (visible) {
      setSearchText('');
    }
  }, [visible]);

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
              placeholder="Search Language/Locale"
              style={styles.searchbar}
            />
          }
          data={searchedLocales}
          renderItem={({ item }) => {
            const flag = localeToFlag[item] || '🏳️'; // Get flag, default to white flag
            return (
              <Pressable
                style={styles.pressableRow}
                onPress={() => {
                  onSelectLocale(item);
                  onDismiss();
                }}
                android_ripple={{ color: theme.rippleColor }}
              >
                <PaperRadioButton
                  value={item}
                  status={item === currentLocale ? 'checked' : 'unchecked'}
                  onPress={() => {
                    onSelectLocale(item);
                    onDismiss();
                  }}
                  color={theme.primary}
                  uncheckedColor={theme.onSurfaceVariant}
                />
                <Text style={[styles.radioLabel, { color: theme.onSurface }]}>
                  {flag} {item}
                </Text>
              </Pressable>
            );
          }}
          keyExtractor={item => item}
          estimatedItemSize={54} // Adjust as needed
          ListEmptyComponent={
            locales.length === 0 ? (
              <ActivityIndicator
                size={24}
                style={styles.activityIndicator}
                color={theme.primary}
              />
            ) : null
          }
        />
      </Modal>
    </Portal>
  );
};

export default LocalePickerModal;

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
});
