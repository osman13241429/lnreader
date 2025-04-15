import React, { useState } from 'react';
import {
  ScrollView,
  View,
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';

import { Appbar, Button, List } from '@components';
import { useTheme } from '@hooks/persisted';
import { useTranslationSettings } from '@hooks/persisted/useSettings';

import SettingSwitch from './components/SettingSwitch';
import ModelDropdown from './components/ModelDropdown';
import { getString } from '@strings/translations';
import {
  TextInput,
  Text,
  Divider,
  Card,
  TouchableRipple,
} from 'react-native-paper';
import { deleteAllTranslations } from '@database/queries/TranslationQueries';
import { showToast } from '@utils/showToast';
import { testConnection } from '@services/translation/TranslationService';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { fixTranslationColumn } from '@services/migration/DatabaseMigration';
import { SettingsStackParamList } from '@navigators/types';
import { StringMap } from '@strings/types';

type TranslationSettingsProps = StackScreenProps<
  SettingsStackParamList,
  'TranslationSettings'
>;

const TranslationSettings = ({ navigation }: TranslationSettingsProps) => {
  const theme = useTheme();
  const {
    apiKey,
    defaultInstruction,
    model,
    autoTranslate,
    setTranslationSettings,
  } = useTranslationSettings();

  const [apiKeyInput, setApiKeyInput] = useState(apiKey);
  const [modelInput, setModelInput] = useState(
    model || 'deepseek/deepseek-chat-v3-0324:free',
  );
  const [instructionInput, setInstructionInput] = useState(defaultInstruction);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isFixingDb, setIsFixingDb] = useState(false);

  const styles = StyleSheet.create({
    card: {
      margin: 16,
      marginTop: 8,
      backgroundColor: theme.surfaceVariant,
    },
    link: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    modelOption: {
      paddingVertical: 8,
    },
    divider: {
      marginVertical: 8,
      backgroundColor: theme.outlineVariant,
    },
  });

  const saveSettings = async () => {
    try {
      setIsSaving(true);
      setTranslationSettings({
        apiKey: apiKeyInput,
        model: modelInput,
        defaultInstruction: instructionInput,
      });
      showToast(getString('translation.settingsSaved' as keyof StringMap));
    } catch (error) {
      showToast(
        `${getString('common.error' as keyof StringMap)}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setIsTesting(true);
      const result = await testConnection(apiKeyInput, modelInput);

      Alert.alert(
        result.success
          ? 'Connection Test Successful'
          : 'Connection Test Failed',
        result.message,
        [{ text: 'OK' }],
      );
    } catch (error) {
      showToast(
        `Test failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setIsTesting(false);
    }
  };

  const handleFixDatabase = async () => {
    try {
      setIsFixingDb(true);
      await fixTranslationColumn();
      showToast('Database fix attempt finished.');
    } catch (error) {
      showToast(
        `Database fix failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setIsFixingDb(false);
    }
  };

  const handleDeleteAllTranslations = async () => {
    Alert.alert(
      'Delete All Translations',
      'Are you sure you want to delete all stored translations? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              const deletedCount = await deleteAllTranslations();
              showToast(
                getString('translation.allDeleted' as keyof StringMap, {
                  count: deletedCount,
                }),
              );
            } catch (error) {
              showToast(
                getString('translation.deleteError' as keyof StringMap, {
                  error:
                    error instanceof Error ? error.message : 'Unknown error',
                }),
              );
            }
          },
        },
      ],
    );
  };

  const setRecommendedModel = (modelId: string) => {
    setModelInput(modelId);
    showToast(`Model set to ${modelId}`);
  };

  const openOpenRouterWebsite = () => {
    Linking.openURL('https://openrouter.ai/keys');
  };

  const openModelDocs = () => {
    Linking.openURL('https://openrouter.ai/docs/models');
  };

  return (
    <>
      <Appbar
        title={getString('translation.settings' as keyof StringMap)}
        handleGoBack={navigation.goBack}
        theme={theme}
      />
      <ScrollView style={{ flex: 1, backgroundColor: theme.background }}>
        <List.Section>
          <List.SubHeader theme={theme}>
            {getString('translation.apiSettings' as keyof StringMap)}
          </List.SubHeader>

          <Card style={styles.card}>
            <Card.Content>
              <Text style={{ color: theme.onSurfaceVariant, marginBottom: 8 }}>
                To use translation, you need an OpenRouter API key:
              </Text>
              <TouchableRipple onPress={openOpenRouterWebsite}>
                <View style={styles.link}>
                  <Icon name="open-in-new" size={16} color={theme.primary} />
                  <Text style={{ color: theme.primary, marginLeft: 8 }}>
                    Get an API key from OpenRouter
                  </Text>
                </View>
              </TouchableRipple>
            </Card.Content>
          </Card>

          <TextInput
            label={getString('translation.apiKey' as keyof StringMap)}
            value={apiKeyInput}
            onChangeText={setApiKeyInput}
            style={{ margin: 16, backgroundColor: theme.surface }}
            theme={{
              ...theme,
              colors: {
                ...theme,
                placeholder: theme.onSurface,
                text: theme.onSurface,
                primary: theme.primary,
              },
            }}
            secureTextEntry
          />

          <Text
            style={{
              marginHorizontal: 16,
              marginTop: 16,
              color: theme.onSurface,
            }}
          >
            {getString('translation.model' as keyof StringMap)}
          </Text>
          <ModelDropdown
            value={modelInput}
            onChange={setModelInput}
            theme={theme}
          />

          <Card style={{ ...styles.card, marginBottom: 16 }}>
            <Card.Title
              title="Recommended Models"
              titleStyle={{ color: theme.onSurface }}
            />
            <Card.Content>
              <TouchableRipple
                onPress={() =>
                  setRecommendedModel('deepseek/deepseek-chat-v3-0324:free')
                }
                style={styles.modelOption}
              >
                <View>
                  <Text style={{ color: theme.onSurface, fontWeight: 'bold' }}>
                    DeepSeek Chat v3-0324 (Free Tier)
                  </Text>
                  <Text style={{ color: theme.onSurfaceVariant, fontSize: 12 }}>
                    Good general-purpose translation model.
                  </Text>
                </View>
              </TouchableRipple>

              <Divider style={styles.divider} />

              <TouchableRipple
                onPress={() =>
                  setRecommendedModel('deepseek/deepseek-r1-zero:free')
                }
                style={styles.modelOption}
              >
                <View>
                  <Text style={{ color: theme.onSurface, fontWeight: 'bold' }}>
                    DeepSeek R1 Zero (Free Tier)
                  </Text>
                  <Text style={{ color: theme.onSurfaceVariant, fontSize: 12 }}>
                    Another strong free option from DeepSeek. During testing, it
                    was found to be slightly better than DeepSeek Chat v3-0324
                    and Gemini 2.5 Pro exp-03-25.
                  </Text>
                </View>
              </TouchableRipple>

              <Divider style={styles.divider} />

              <TouchableRipple
                onPress={() =>
                  setRecommendedModel('google/gemini-2.5-pro-exp-03-25:free')
                }
                style={styles.modelOption}
              >
                <View>
                  <Text style={{ color: theme.onSurface, fontWeight: 'bold' }}>
                    Gemini 2.5 Pro exp-03-25 (Experimental Free Tier)
                  </Text>
                  <Text style={{ color: theme.onSurfaceVariant, fontSize: 12 }}>
                    Latest experimental model from Google, may have
                    restrictions. Second best model during testing.
                  </Text>
                </View>
              </TouchableRipple>

              <TouchableRipple
                onPress={openModelDocs}
                style={{ marginTop: 16 }}
              >
                <View style={styles.link}>
                  <Icon
                    name="information-outline"
                    size={16}
                    color={theme.primary}
                  />
                  <Text style={{ color: theme.primary, marginLeft: 8 }}>
                    Learn more about available models
                  </Text>
                </View>
              </TouchableRipple>
            </Card.Content>
          </Card>

          <TextInput
            label={getString('translation.instruction' as keyof StringMap)}
            value={instructionInput}
            onChangeText={setInstructionInput}
            style={{ margin: 16, backgroundColor: theme.surface }}
            theme={{
              ...theme,
              colors: {
                ...theme,
                placeholder: theme.onSurface,
                text: theme.onSurface,
                primary: theme.primary,
              },
            }}
            multiline
            numberOfLines={4}
          />

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginHorizontal: 16,
            }}
          >
            <Button
              title={
                isSaving
                  ? '...'
                  : getString('translation.saveSettings' as keyof StringMap)
              }
              onPress={saveSettings}
              mode="contained"
              style={{ flex: 1, marginRight: 8 }}
              disabled={isSaving || isTesting}
            />
            <Button
              title={isTesting ? '...' : 'Test Connection'}
              onPress={handleTestConnection}
              mode="outlined"
              style={{ flex: 1, marginLeft: 8 }}
              disabled={isSaving || isTesting || !apiKeyInput || !modelInput}
            />
          </View>

          {(isSaving || isTesting) && (
            <ActivityIndicator
              size="small"
              color={theme.primary}
              style={{ marginTop: 16, marginBottom: 16 }}
            />
          )}

          <Text
            style={{
              marginHorizontal: 16,
              marginTop: 8,
              color: theme.onSurfaceVariant,
              fontSize: 12,
            }}
          >
            Note: The "No endpoints found matching your data policy" error
            usually means the selected model is not available with your current
            OpenRouter API key or plan.
          </Text>
        </List.Section>

        <List.Section>
          <List.SubHeader theme={theme}>
            {getString('translation.options' as keyof StringMap)}
          </List.SubHeader>
          <SettingSwitch
            label={getString('translation.autoTranslate' as keyof StringMap)}
            value={autoTranslate}
            onPress={() =>
              setTranslationSettings({ autoTranslate: !autoTranslate })
            }
            theme={theme}
          />
          <Button
            title={getString(
              'translation.manageTranslations' as keyof StringMap,
            )}
            onPress={() => navigation.navigate('TranslationList')}
            mode="contained"
            style={{ margin: 16 }}
            buttonColor={theme.primary}
            textColor={theme.onPrimary}
          />
          <Button
            title={getString('translation.deleteAll' as keyof StringMap)}
            onPress={handleDeleteAllTranslations}
            mode="outlined"
            style={{ margin: 16 }}
            buttonColor={theme.surface}
            textColor={theme.error}
          />
        </List.Section>

        <List.Section>
          <List.SubHeader theme={theme}>Troubleshooting</List.SubHeader>
          <Card style={styles.card}>
            <Card.Content>
              <Text style={{ color: theme.onSurfaceVariant, marginBottom: 12 }}>
                If you see "no such column: hasTranslation" errors, use this
                button to fix the database:
              </Text>
              <Button
                title={isFixingDb ? 'Fixing Database...' : 'Fix Database'}
                onPress={handleFixDatabase}
                mode="contained"
                buttonColor={theme.primary}
                textColor={theme.onPrimary}
                disabled={isFixingDb}
              />
              {isFixingDb && (
                <ActivityIndicator
                  size="small"
                  color={theme.primary}
                  style={{ marginTop: 12 }}
                />
              )}
            </Card.Content>
          </Card>
        </List.Section>
      </ScrollView>
    </>
  );
};

export default TranslationSettings;
