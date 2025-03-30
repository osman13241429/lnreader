import NovelUpdatesSettings from '@screens/settings/NovelUpdatesSettings';
import TranslationsSettings from '@screens/settings/TranslationsSettings';
import WebviewSettings from '@screens/settings/WebviewSettings';
import TranslationListScreen from '@screens/settings/TranslationListScreen';

function SettingsStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="SettingsScreenContainer"
        component={SettingsScreenContainer}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="ChromeReaderSettings"
        component={ChromeReaderSettings}
      />
      <Stack.Screen
        name="TranslationsSettings"
        component={TranslationsSettings}
      />
      <Stack.Screen
        name="TranslationList"
        component={TranslationListScreen}
      />
    </Stack.Navigator>
  );
}

export default SettingsStack; 