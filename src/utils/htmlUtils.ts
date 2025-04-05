import FileManager from '@native/FileManager';
import { getPlugin } from '@plugins/pluginManager';
import { resolveUrl } from '@services/plugin/fetch';
import { showToast } from './showToast';

// Simple regex to find <img> tags and their src attribute
const imgRegex = /<img[^>]+src\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;

/**
 * Processes HTML content to find images, download them, and embed them as Base64 data URIs.
 * @param htmlContent The original HTML content.
 * @param chapterPath The original path/URL of the chapter (for resolving relative URLs).
 * @param pluginId The plugin ID (for getting base URL and headers).
 * @param embedImages Whether to actually embed the images.
 * @returns The processed HTML content with images embedded (if requested).
 */
export const processHtmlContentForImages = async (
  htmlContent: string,
  chapterPath: string,
  pluginId: string,
  embedImages: boolean,
): Promise<string> => {
  if (!embedImages || !htmlContent) {
    return htmlContent;
  }

  const plugin = getPlugin(pluginId);
  if (!plugin) {
    return htmlContent;
  }

  let processedHtml = htmlContent;
  const matches = Array.from(htmlContent.matchAll(imgRegex));
  const imagePromises: Promise<{
    placeholder: string;
    replacement: string;
  } | null>[] = [];
  let imageCount = 0;
  let failedCount = 0;

  for (const match of matches) {
    const originalTag = match[0];
    const imgSrc = match[1] || match[2] || match[3]; // Get the src value

    if (!imgSrc || imgSrc.startsWith('data:')) {
      // Skip if src is missing or already a data URI
      continue;
    }

    imageCount++;
    const imageProcessingPromise = (async () => {
      try {
        // Resolve the absolute URL for the image
        const absoluteImageUrl = resolveUrl(pluginId, imgSrc);
        const headers = plugin.imageRequestInit?.headers || {};
        const method = plugin.imageRequestInit?.method || 'GET';
        const body = plugin.imageRequestInit?.body;

        // Define a temporary path for the downloaded image
        const fileExtension =
          absoluteImageUrl.split('.').pop()?.split('?')[0] || 'jpg';
        const tempImageName = `temp_img_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2)}.${fileExtension}`;
        const tempImagePath = `${FileManager.ExternalCachesDirectoryPath}/${tempImageName}`;

        // Download the image
        await FileManager.downloadFile(
          absoluteImageUrl,
          tempImagePath,
          method,
          headers,
          body,
        );

        // Read the downloaded image file as binary data
        const binaryData = await (FileManager as any).readFile(
          tempImagePath,
          'base64',
        );

        if (!binaryData) {
          throw new Error('Failed to read downloaded image file.');
        }

        // Determine MIME type (basic)
        let mimeType = 'image/jpeg';
        if (fileExtension.toLowerCase() === 'png') {
          mimeType = 'image/png';
        } else if (fileExtension.toLowerCase() === 'gif') {
          mimeType = 'image/gif';
        } else if (fileExtension.toLowerCase() === 'webp') {
          mimeType = 'image/webp';
        }

        // Create Base64 data URI
        const dataUri = `data:${mimeType};base64,${binaryData}`;

        // Replace the original src in the processed HTML
        // Use a temporary placeholder to avoid issues with replacing parts of already replaced tags
        const placeholder = `__IMAGE_PLACEHOLDER_${imageCount}__`;
        processedHtml = processedHtml.replace(originalTag, placeholder);

        // Store the final replacement
        return {
          placeholder,
          replacement: originalTag.replace(imgSrc, dataUri),
        };
      } catch (error) {
        failedCount++;
        // Return null or a specific marker to indicate failure for this image
        return null;
      } finally {
        // Clean up temporary file - needs adjustment if readFile doesn't take path
        // await FileManager.unlink(tempImagePath).catch(e => console.error('Failed to delete temp image:', e));
      }
    })();
    imagePromises.push(imageProcessingPromise);
  }

  // Wait for all image processing attempts to complete
  const results = await Promise.all(imagePromises);

  // Perform replacements after all downloads are attempted
  results.forEach(result => {
    if (result && result.placeholder && result.replacement) {
      processedHtml = processedHtml.replace(
        result.placeholder,
        result.replacement,
      );
    }
  });

  if (imageCount > 0) {
    const successCount = imageCount - failedCount;
    showToast(
      `Image embedding: ${successCount} successful, ${failedCount} failed.`,
    );
  }

  return processedHtml;
};
