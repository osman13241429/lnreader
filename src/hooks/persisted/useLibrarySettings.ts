import { MMKVStorage, useMMKVStorage } from '@utils/mmkv/mmkv';

import {
  LibraryFilter,
  LibrarySortOrder,
} from '@screens/library/constants/constants';
import { DisplayModes } from '@screens/library/constants/constants';

export interface LibrarySettings {
  sortOrder?: LibrarySortOrder;
  filter?: LibraryFilter;
  showDownloadBadges?: boolean;
  showUnreadBadges?: boolean;
  showNumberOfNovels?: boolean;
  displayMode?: DisplayModes;
  showHistoryTab?: boolean;
  showUpdatesTab?: boolean;
  showLabelsInNav?: boolean;
  downloadedOnlyMode?: boolean;
  incognitoMode?: boolean;
}

const librarySettingsStorage = new MMKVStorage('SETTINGS_LIBRARY');

export const useLibrarySettings = () => {
  const [librarySettings, setLibrarySettings] = useMMKVStorage<LibrarySettings>(
    'SETTINGS_LIBRARY',
    librarySettingsStorage,
  );

  return {
    ...librarySettings,
    setLibrarySettings,
  };
};
