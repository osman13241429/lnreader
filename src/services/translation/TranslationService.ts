import { showToast } from '@utils/showToast';
import {
  TranslateChapterTask,
  BackgroundTaskMetadata,
} from '@services/ServiceManager';
import FileManager from '@native/FileManager';
import { NOVEL_STORAGE } from '@utils/Storages';
import { saveTranslation } from '@database/queries/TranslationQueries';
import { db } from '@database/db';
import { getNovelById } from '@database/queries/NovelQueries';
import {
  getChapterInfo,
  updateChapterTranslationState,
  getTranslation,
} from '@database/queries/ChapterQueries';

export interface TranslationResponse {
  content: string;
  model: string;
  instruction: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing?: {
    prompt: string;
    completion: string;
  };
}

export const fetchAvailableModels = async (): Promise<OpenRouterModel[]> => {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: {
        'HTTP-Referer': 'https://lnreader.org',
        'X-Title': 'LNReader',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Invalid response format from OpenRouter API');
    }

    // Extract relevant information and filter for text-to-text models
    return data.data
      .filter(
        (model: any) =>
          model.architecture?.modality === 'text->text' ||
          model.architecture?.modality === 'text+image->text',
      )
      .map((model: any) => ({
        id: model.id,
        name: model.name || model.id,
        description: model.description,
        pricing: model.pricing
          ? {
              prompt: model.pricing.prompt,
              completion: model.pricing.completion,
            }
          : undefined,
      }));
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    showToast(`Error: ${errorMessage}`);
    return [];
  }
};

export const testConnection = async (
  apiKey: string,
  model: string,
): Promise<{ success: boolean; message: string }> => {
  try {
    if (!apiKey) {
      return {
        success: false,
        message: 'No API key provided. Please set an API key in settings.',
      };
    }

    if (!model) {
      return {
        success: false,
        message: 'No model selected. Please select a model in settings.',
      };
    }

    // First check if the API key is valid by making a models request with auth
    const modelsResponse = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://lnreader.org',
        'X-Title': 'LNReader',
      },
    });

    if (!modelsResponse.ok) {
      if (modelsResponse.status === 401) {
        return {
          success: false,
          message: 'Invalid API key. Please check your API key in settings.',
        };
      }
      throw new Error(`Failed to verify API key: ${modelsResponse.statusText}`);
    }

    // Make a small test completion to verify model access
    const testResponse = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://lnreader.org',
          'X-Title': 'LNReader',
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant.',
            },
            {
              role: 'user',
              content: 'Send a very short response to test the connection.',
            },
          ],
          max_tokens: 10,
        }),
      },
    );

    // Check response
    if (!testResponse.ok) {
      const errorData = await testResponse.json().catch(() => ({
        error: { message: `HTTP error ${testResponse.status}` },
      }));

      // More detailed error handling
      if (testResponse.status === 403) {
        return {
          success: false,
          message:
            'Access denied: The selected model may not be available with your current API key or subscription plan.',
        };
      } else if (testResponse.status === 404) {
        return {
          success: false,
          message:
            'Model not found: The selected model ID is invalid or not available.',
        };
      } else if (errorData.error?.message?.includes('data policy')) {
        return {
          success: false,
          message:
            "No endpoints found matching your data policy. This model may have requirements your API key doesn't meet.",
        };
      }

      throw new Error(
        errorData.error?.message || `Test failed: ${testResponse.statusText}`,
      );
    }

    return {
      success: true,
      message:
        'Connection successful! Your API key and model are working correctly.',
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    return { success: false, message: errorMessage };
  }
};

export const translateText = async (
  apiKey: string,
  text: string,
  model = 'openai/gpt-3.5-turbo',
  instruction = '',
): Promise<TranslationResponse> => {
  // Validate inputs
  if (!apiKey) {
    throw new Error('API key is required');
  }

  if (!text || text.trim() === '') {
    throw new Error('Text to translate is required');
  }

  /**
   * We enhance the instruction to ensure the AI preserves formatting.
   * This is critical for maintaining text structure like paragraphs,
   * indentation, and line breaks in the translated content.
   *
   * The white-space: pre-wrap CSS and HTML processing of the response
   * (converting \n to <br/>) work together to maintain proper formatting
   * in the WebView display.
   */
  const formattingNote =
    'IMPORTANT: Preserve all original formatting including line breaks, paragraphs, whitespace, and indentation. The translated text should maintain the exact same structure as the original.';
  const enhancedInstruction = instruction
    ? `${instruction}\n\n${formattingNote}`
    : formattingNote;

  try {
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/LNReader/lnreader',
          'X-Title': 'LNReader',
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: enhancedInstruction,
            },
            {
              role: 'user',
              content: text,
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: { message: `HTTP error ${response.status}` } }));

      // Handle specific error cases
      if (response.status === 429) {
        // Construct a more user-friendly message for rate limits/quotas
        let detail =
          'You have exceeded your quota or hit a rate limit for the selected model.';
        if (errorData?.error?.message) {
          // Try to include the specific message from the provider if available
          // Example: "You exceeded your current quota..."
          detail += ` Provider message: ${errorData.error.message}`;
        }
        detail +=
          ' Please check your API key quota, try a different model, or disable parallel translations if enabled.';
        throw new Error(detail);
      } else if (response.status === 403) {
        throw new Error(
          'Access denied: You may not have permission to use this model with your API key.',
        );
      } else if (response.status === 404) {
        throw new Error(
          'Model not found: The selected model ID is invalid or not available.',
        );
      }

      // For other errors, throw a generic error with the message if available
      throw new Error(
        errorData.error?.message ||
          `Translation failed: ${response.statusText}`,
      );
    }

    const data = await response.json();

    // Check for explicit error in the first choice
    if (data.choices?.[0]?.error) {
      const choiceError = data.choices[0].error;
      const providerName =
        choiceError.metadata?.provider_name ||
        data.provider ||
        'Unknown Provider';
      const errorMessage = choiceError.message || 'Unknown provider error';
      const errorCode = choiceError.code || 'N/A';
      console.error(
        `[ERROR] Provider error received: Provider=${providerName}, Code=${errorCode}, Message=${errorMessage}, RawChoiceError=`,
        JSON.stringify(choiceError),
      );
      throw new Error(
        `Translation failed: Provider error (${providerName} - Code: ${errorCode}): ${errorMessage}`,
      );
    }

    // Validate expected response format otherwise
    if (
      !data.choices ||
      !data.choices[0] ||
      !data.choices[0].message ||
      typeof data.choices[0].message.content !== 'string' // Check content is a string
    ) {
      console.error(
        '[ERROR] Unexpected API response format. Logging raw data:',
        JSON.stringify(data),
      ); // Log raw data
      throw new Error('Unexpected response format from translation service');
    }

    return {
      content: data.choices[0].message.content,
      model: data.model || model,
      instruction: enhancedInstruction,
    };
  } catch (error) {
    // Re-throw the error to be handled by the caller
    throw error;
  }
};

export class DependencyMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyMissingError';
  }
}

/**
 * Executes the translation task for a single chapter in the background.
 */
export const translateChapterTask = async (
  data: TranslateChapterTask['data'],
  setMeta: (
    transformer: (meta: BackgroundTaskMetadata) => BackgroundTaskMetadata,
  ) => void,
): Promise<void> => {
  const {
    chapterId,
    novelId,
    pluginId,
    apiKey,
    model,
    instruction,
    chapterName,
  } = data;

  setMeta(meta => ({
    ...meta,
    isRunning: true,
    progress: 0,
    progressText: 'Starting translation...',
  }));

  try {
    // 1. Check if already translated (content or name)
    setMeta(meta => ({ ...meta, progressText: 'Checking existing...' }));
    const chapterInfo = await getChapterInfo(chapterId); // Helper to get chapter info including translatedName
    if (!chapterInfo) {
      throw new Error('Chapter not found in database.');
    }

    if (chapterInfo.hasTranslation && chapterInfo.translatedName) {
      setMeta(meta => ({
        ...meta,
        progress: 1,
        isRunning: false,
        progressText: 'Already translated (content & name)',
      }));
      return;
    }

    // 2. Check if chapter content exists locally
    setMeta(meta => ({
      ...meta,
      progress: 0.1, // Adjusted progress
      progressText: 'Locating content...',
    }));
    const filePath = `${NOVEL_STORAGE}/${pluginId}/${novelId}/${chapterId}/index.html`;
    const fileExists = await FileManager.exists(filePath);

    if (!fileExists) {
      throw new DependencyMissingError(
        `Chapter content not found for '${chapterName}'. Waiting for download.`,
      );
    }

    // 3. Read content
    setMeta(meta => ({
      ...meta,
      progress: 0.2, // Adjusted progress
      progressText: 'Reading content...',
    }));
    const chapterContent = await FileManager.readFile(filePath);
    if (!chapterContent || chapterContent.trim() === '') {
      throw new Error('Chapter content is empty.');
    }

    let translatedContent = '';
    let translatedTitle = chapterInfo.translatedName; // Use existing if available
    let translationModel = '';
    let translationInstruction = '';

    // 4. Translate Content (if needed)
    if (!chapterInfo.hasTranslation) {
      setMeta(meta => ({
        ...meta,
        progress: 0.4, // Adjusted progress
        progressText: 'Translating content...',
      }));
      const contentResult = await translateText(
        apiKey,
        chapterContent,
        model,
        instruction,
      );
      translatedContent = contentResult.content
        .replace(/\n/g, '<br/>')
        .replace(/ {2}/g, '&nbsp;&nbsp;');
      translationModel = contentResult.model;
      translationInstruction = contentResult.instruction;
    } else {
      // If content is already translated, fetch existing translation details
      const existingTranslation = await getTranslation(chapterId);
      if (existingTranslation) {
        translatedContent = existingTranslation.content; // Need existing content for saving later
        translationModel = existingTranslation.model;
        translationInstruction = existingTranslation.instruction || '';
      } else {
        // This case shouldn't happen if hasTranslation is true, but handle defensively
        throw new Error(
          'Inconsistent state: Chapter marked as translated but no translation found.',
        );
      }
      setMeta(meta => ({
        ...meta,
        progress: 0.6, // Skip content translation progress
        progressText: 'Content already translated',
      }));
    }

    // 5. Translate Title (if needed and original exists)
    if (
      !translatedTitle &&
      chapterInfo.name &&
      chapterInfo.name.trim() !== ''
    ) {
      setMeta(meta => ({
        ...meta,
        progress: 0.7, // Adjusted progress
        progressText: 'Translating title...',
      }));
      // Small delay before title translation
      await new Promise(resolve => setTimeout(resolve, 500));
      const titleResult = await translateText(
        apiKey,
        chapterInfo.name, // Use original name from fetched chapterInfo
        model,
        'Translate only the title provided.', // Simple instruction for title
      );
      translatedTitle = titleResult.content.trim(); // Trim potential whitespace
    } else {
      setMeta(meta => ({
        ...meta,
        progress: 0.8, // Skip title translation progress
        progressText: 'Title already translated or empty',
      }));
    }

    // 6. Save content translation (if content was translated) and update chapter title
    setMeta(meta => ({ ...meta, progress: 0.9, progressText: 'Saving...' }));
    if (!chapterInfo.hasTranslation && translatedContent) {
      await saveTranslation(
        chapterId,
        translatedContent,
        translationModel,
        translationInstruction,
      );
    }

    // Update hasTranslation flag and translatedName in Chapter table
    await updateChapterTranslationState(chapterId, translatedTitle);

    // 7. Mark as complete
    setMeta(meta => ({
      ...meta,
      progress: 1,
      isRunning: false,
      progressText: 'Translation complete (content & title)',
    }));
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown translation error';
    setMeta(meta => ({
      ...meta,
      isRunning: false,
      progressText: `Error: ${errorMessage}`,
    }));
    throw error;
  }
};

// Added: Task implementation for translating novel metadata
export const translateNovelMetaTask = async (
  data: TranslateNovelMetaTask['data'],
  setMeta: (
    transformer: (meta: BackgroundTaskMetadata) => BackgroundTaskMetadata,
  ) => void,
): Promise<void> => {
  const { novelId, apiKey, model, instruction, novelName } = data;
  // console.log(`[TASK_START] translateNovelMetaTask for Novel ID: ${novelId}, Name: ${novelName}`);

  setMeta(meta => ({
    ...meta,
    isRunning: true,
    progress: 0,
    progressText: `Starting meta translation for ${novelName}...`,
  }));

  try {
    // 1. Get current novel info
    setMeta(meta => ({
      ...meta,
      progress: 0.1,
      progressText: 'Fetching novel details...',
    }));
    const novel = await getNovelById(novelId);
    // console.log(`[FETCH_NOVEL] Fetched novel data:`, novel); // Log fetched data

    if (!novel) {
      // console.error(`[ERROR] Novel with ID ${novelId} not found.`);
      throw new Error(`Novel with ID ${novelId} not found.`);
    }

    // 2. Check if already translated
    // console.log(`[CHECK_TRANSLATED] Checking existing: Name='${novel.translatedName}', Summary='${novel.translatedSummary ? novel.translatedSummary.substring(0,30)+'...':null}'`);
    if (novel.translatedName && novel.translatedSummary) {
      // console.log(`[ALREADY_TRANSLATED] Metadata seems to be already translated. Exiting task.`);
      setMeta(meta => ({
        ...meta,
        progress: 1,
        isRunning: false,
        progressText: 'Metadata already translated',
      }));
      return;
    }

    // 3. Translate Name (if needed)
    let translatedName = novel.translatedName;
    if (!translatedName && novel.name) {
      setMeta(meta => ({
        ...meta,
        progress: 0.3,
        progressText: 'Translating title...',
      }));
      // console.log(`[TRANSLATE_NAME] Starting name translation for: '${novel.name}'`);
      const nameResult = await translateText(
        apiKey,
        novel.name,
        model,
        instruction,
      );
      translatedName = nameResult.content;
      // console.log(`[TRANSLATE_NAME_DONE] Translated name result: '${translatedName}'`);
    } else {
      // console.log(`[TRANSLATE_NAME_SKIP] Skipping name translation (already exists or original is empty).`);
      setMeta(meta => ({
        ...meta,
        progress: 0.5,
        progressText: 'Title already translated or empty',
      }));
    }

    // Add a small delay before translating summary
    // console.log('[DELAY] Waiting 1 second before summary translation...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. Translate Summary (if needed)
    let translatedSummary = novel.translatedSummary;
    if (!translatedSummary && novel.summary) {
      setMeta(meta => ({
        ...meta,
        progress: 0.6,
        progressText: 'Translating summary...',
      }));
      // console.log(`[TRANSLATE_SUMMARY] Starting summary translation for: '${novel.summary.substring(0, 50)}...'`);
      const summaryResult = await translateText(
        apiKey,
        novel.summary,
        model,
        instruction,
      );
      translatedSummary = summaryResult.content;
      // console.log(`[TRANSLATE_SUMMARY_DONE] Translated summary result: '${translatedSummary.substring(0, 50)}...'`);
    } else {
      // console.log(`[TRANSLATE_SUMMARY_SKIP] Skipping summary translation (already exists or original is empty).`);
      setMeta(meta => ({
        ...meta,
        progress: 0.8,
        progressText: 'Summary already translated or empty',
      }));
    }

    // 5. Update database
    setMeta(meta => ({
      ...meta,
      progress: 0.9,
      progressText: 'Saving metadata... ',
    }));
    // console.log(`[DB_UPDATE] Attempting to update DB with Name='${translatedName}', Summary='${translatedSummary ? translatedSummary.substring(0,30)+'...':null}'`);
    await new Promise<void>((resolve, reject) => {
      db.transaction(tx => {
        tx.executeSql(
          'UPDATE Novel SET translatedName = ?, translatedSummary = ? WHERE id = ?',
          [translatedName || null, translatedSummary || null, novelId],
          () => {
            // console.log(`[DB_UPDATE_SUCCESS] Database updated successfully for Novel ID: ${novelId}`);
            resolve();
          },
          (_, error) => {
            // console.error(`[DB_UPDATE_ERROR] Failed to update database for Novel ID: ${novelId}`, error);
            reject(error);
            return false;
          },
        );
      });
    });

    // 6. Mark as complete
    // console.log(`[TASK_COMPLETE] translateNovelMetaTask finished for Novel ID: ${novelId}`);
    setMeta(meta => ({
      ...meta,
      progress: 1,
      isRunning: false,
      progressText: 'Metadata translation complete',
    }));
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown translation error';
    // console.error(`[TASK_ERROR] Error in translateNovelMetaTask for Novel ID: ${novelId}:`, errorMessage, error);
    setMeta(meta => ({
      ...meta,
      isRunning: false,
      progressText: `Error: ${errorMessage}`,
    }));
    throw error;
  }
};
