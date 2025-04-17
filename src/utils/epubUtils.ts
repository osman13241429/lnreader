import FileManager from '@native/FileManager';
import { ChapterInfo, NovelInfo, TranslationInfo } from '@database/types';
import { getPlugin } from '@plugins/pluginManager';
import { resolveUrl } from '@services/plugin/fetch';
import { showToast } from '@utils/showToast';
import { v4 as uuidv4 } from 'uuid';
import { zip } from 'react-native-zip-archive';
import { NOVEL_STORAGE } from '@utils/Storages';
import { getTranslation } from '@database/queries/TranslationQueries';

// Types for EPUB specific data
type ImageResource = {
  id: string;
  src: string;
  mediaType: string;
  destinationPath: string;
  originalSrc: string;
};

type ChapterResource = {
  id: string;
  href: string;
  mediaType: string;
  title: string;
  position: number;
  properties?: string[];
};

type EpubOptions = {
  title: string;
  author?: string;
  language?: string;
  identifier?: string;
  description?: string;
  publisher?: string;
  coverPath?: string;
  stylesheet?: string;
  embedImages?: boolean;
  pluginId?: string;
  useTranslatedContent?: boolean;
  useChapterNumberOnlyTitle?: boolean;
};

// Helper to escape XML special characters
const escapeXml = (unsafe: string): string => {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

// Get the MIME type for a file based on extension
const getMimeType = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'css':
      return 'text/css';
    case 'js':
      return 'application/javascript';
    case 'html':
    case 'xhtml':
      return 'application/xhtml+xml';
    default:
      return 'application/octet-stream';
  }
};

/**
 * Creates an EPUB package from content documents
 */
export class EpubPackage {
  private workDir: string;
  private contentDir: string = ''; // Initialize with empty string
  private metaInfDir: string;
  private oebpsDir: string;
  private imagesDir: string;
  private cssDir: string;
  private contentDocsDir: string;
  private options: EpubOptions;
  private images: ImageResource[] = [];
  private chapters: ChapterResource[] = [];
  private outputFile: string;
  private stylesheet: string;

  constructor(options: EpubOptions, outputPath: string) {
    this.options = {
      language: 'en',
      identifier: `urn:uuid:${uuidv4()}`,
      ...options,
    };

    // Generate a timestamp for temp directory
    const timestamp = Date.now();
    this.workDir = `${FileManager.ExternalCachesDirectoryPath}/epub_temp_${timestamp}`;
    this.metaInfDir = `${this.workDir}/META-INF`;
    this.oebpsDir = `${this.workDir}/OEBPS`;
    this.imagesDir = `${this.oebpsDir}/images`;
    this.cssDir = `${this.oebpsDir}/css`;
    this.contentDocsDir = `${this.oebpsDir}/content`;
    this.outputFile = outputPath;
    this.stylesheet = options.stylesheet || this.getDefaultStylesheet();
  }

  /**
   * Initialize the EPUB structure
   */
  async prepare(): Promise<void> {
    try {
      // Create directory structure
      await FileManager.mkdir(this.workDir);
      await FileManager.mkdir(this.metaInfDir);
      await FileManager.mkdir(this.oebpsDir);
      await FileManager.mkdir(this.imagesDir);
      await FileManager.mkdir(this.cssDir);
      await FileManager.mkdir(this.contentDocsDir);

      // Create mimetype file (must be first in the archive and uncompressed)
      await FileManager.writeFile(
        `${this.workDir}/mimetype`,
        'application/epub+zip',
      );

      // Create container.xml
      const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
      await FileManager.writeFile(
        `${this.metaInfDir}/container.xml`,
        containerXml,
      );

      // Create CSS
      await FileManager.writeFile(`${this.cssDir}/style.css`, this.stylesheet);
    } catch (error) {
      console.error('Failed to prepare EPUB structure:', error);
      throw new Error(
        `Failed to prepare EPUB structure: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Get default stylesheet
   */
  private getDefaultStylesheet(): string {
    return `
/* Base EPUB stylesheet */
body {
  font-family: serif;
  line-height: 1.5;
  margin: 1em;
  padding: 0;
}

h1, h2, h3, h4, h5, h6 {
  font-family: sans-serif;
  line-height: 1.2;
  margin: 1em 0 0.5em 0;
}

h1 {
  font-size: 1.5em;
  page-break-before: always;
  text-align: center;
}

h2 {
  font-size: 1.3em;
}

h3 {
  font-size: 1.1em;
}

p {
  margin: 0.5em 0;
  text-indent: 1.5em;
}

img {
  max-width: 100%;
  height: auto;
}

.chapter {
  page-break-after: always;
}

.nav-toc {
  margin: 1em 0;
  padding: 0;
}

.nav-toc li {
  list-style-type: none;
  margin: 0.5em 0;
}
`;
  }

  /**
   * Add a chapter to the EPUB
   */
  async addChapter(
    title: string,
    html: string,
    position: number,
  ): Promise<string> {
    try {
      const chapterId = `chapter-${position}`;
      const chapterFilename = `${chapterId}.xhtml`;
      const chapterPath = `${this.contentDocsDir}/${chapterFilename}`;

      // Process HTML to extract and handle images if embedImages is enabled
      let processedHtml = html;
      if (this.options.embedImages && this.options.pluginId) {
        processedHtml = await this.extractAndProcessImages(html, position);
      }

      // Ensure BR tags are self-closing
      processedHtml = processedHtml.replace(
        /<br\s*(?!\/)>|<br>(?!\s*\/?)/gi,
        '<br/>',
      );

      // Create valid XHTML document
      const chapterContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <meta charset="utf-8"/>
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="../css/style.css"/>
  </head>
  <body>
    <div class="chapter">
      <h1>${escapeXml(title)}</h1>
      <div>
        ${processedHtml}
      </div>
    </div>
  </body>
</html>`;

      // Write chapter file
      await FileManager.writeFile(chapterPath, chapterContent);

      // Add to chapters list
      this.chapters.push({
        id: chapterId,
        href: `content/${chapterFilename}`,
        mediaType: 'application/xhtml+xml',
        title: title,
        position: position,
      });

      return chapterId;
    } catch (error) {
      console.error(`Failed to add chapter "${title}":`, error);
      throw new Error(
        `Failed to add chapter: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Process HTML content to extract images and replace with local references
   */
  private async extractAndProcessImages(
    html: string,
    chapterPosition: number,
  ): Promise<string> {
    if (!this.options.pluginId) {
      return html;
    }

    const plugin = getPlugin(this.options.pluginId);
    if (!plugin) {
      console.warn(
        `Plugin not found for ID: ${this.options.pluginId} during image processing.`,
      );
      return html;
    }

    // Simple regex to find <img> tags and their src attribute
    const imgRegex =
      /<img[^>]+src\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;

    let processedHtml = html;
    const matches = Array.from(html.matchAll(imgRegex));
    let imageCount = 0;

    for (const match of matches) {
      const originalTag = match[0];
      const imgSrc = match[1] || match[2] || match[3]; // Get the src value

      if (!imgSrc || imgSrc.startsWith('data:')) {
        // Skip if src is missing or already a data URI
        continue;
      }

      try {
        // Determine if this is a local file or remote URL
        const isLocalFile =
          imgSrc.startsWith('file://') ||
          (imgSrc.startsWith('/') && !imgSrc.startsWith('//'));

        // Get file extension and prepare a filename
        const fileExtension = imgSrc.split('.').pop()?.split('?')[0] || 'jpg';
        const imageId = `img-${chapterPosition}-${++imageCount}`;
        const imageFilename = `${imageId}.${fileExtension}`;
        const imagePath = `${this.imagesDir}/${imageFilename}`;

        if (isLocalFile) {
          // For local files, copy directly instead of downloading
          const sourcePath = imgSrc.startsWith('file://')
            ? imgSrc.replace('file://', '')
            : imgSrc;

          if (await FileManager.exists(sourcePath)) {
            await FileManager.copyFile(sourcePath, imagePath);
          } else {
            console.error(`Local image file not found: ${sourcePath}`);
            continue;
          }
        } else {
          // For remote URLs, download as before
          // Resolve the absolute URL for the image
          const absoluteImageUrl = resolveUrl(this.options.pluginId, imgSrc);
          const headers = plugin.imageRequestInit?.headers || {};
          const method = plugin.imageRequestInit?.method || 'GET';
          const body = plugin.imageRequestInit?.body;

          // Download the image to the EPUB images directory
          await FileManager.downloadFile(
            absoluteImageUrl,
            imagePath,
            method,
            headers,
            body,
          );
        }

        // Add to images registry for manifest
        const mediaType = getMimeType(imageFilename);
        this.images.push({
          id: imageId,
          src: `images/${imageFilename}`,
          mediaType,
          destinationPath: imagePath,
          originalSrc: imgSrc,
        });

        // Replace the image src in the HTML with relative path
        const relativeRef = `../images/${imageFilename}`;
        const newImgTag = originalTag.replace(
          new RegExp(
            `(src\\s*=\\s*["'])${imgSrc.replace(
              /[.*+?^${}()|[\]\\]/g,
              '\\$&',
            )}(["'])`,
            'i',
          ),
          `$1${relativeRef}$2`,
        );

        processedHtml = processedHtml.replace(originalTag, newImgTag);
      } catch (error) {
        console.error(`Failed to process image: ${imgSrc}`, error);
        // Leave original tag in place if processing fails
      }
    }

    return processedHtml;
  }

  /**
   * Add a cover image to the EPUB
   */
  async addCoverImage(coverPath: string): Promise<void> {
    try {
      if (!coverPath) {
        console.warn('No cover path provided');
        return;
      }

      let localCoverPath = coverPath;

      // Handle cover path based on format
      if (coverPath.startsWith('http')) {
        // Download remote cover
        const coverFileName = coverPath.split('/').pop() || 'cover.jpg';
        localCoverPath = `${FileManager.ExternalCachesDirectoryPath}/${coverFileName}`;
        try {
          if (!(await FileManager.exists(localCoverPath))) {
            await FileManager.downloadFile(
              coverPath,
              localCoverPath,
              'GET',
              {},
            );
          }
        } catch (downloadError) {
          console.warn('Failed to download cover image:', downloadError);
          return;
        }
      } else if (coverPath.startsWith('file://')) {
        // Convert file:// URI to local path
        localCoverPath = coverPath.replace('file://', '');
      }

      // Check if the cover exists
      const coverExists = await FileManager.exists(localCoverPath);
      if (!coverExists) {
        console.warn('Cover image not found at path:', localCoverPath);

        // Try alternative paths
        const possibleAlternatePaths = [
          // Try without file:// prefix if it was present
          coverPath.startsWith('file://')
            ? coverPath.replace('file://', '')
            : null,
          // Try with app's document directory if path is relative
          coverPath.startsWith('/')
            ? null
            : `${FileManager.ExternalCachesDirectoryPath}/${coverPath}`,
        ].filter(Boolean);

        let foundAlternativePath = false;
        for (const altPath of possibleAlternatePaths) {
          if (altPath && (await FileManager.exists(altPath))) {
            localCoverPath = altPath;
            foundAlternativePath = true;
            break;
          }
        }

        if (!foundAlternativePath) {
          console.warn('No valid cover image found - skipping cover');
          return;
        }
      }

      // Get file extension
      const fileExtension =
        localCoverPath.split('.').pop()?.toLowerCase() || 'jpg';
      const coverFilename = `cover.${fileExtension}`;
      const epubCoverPath = `${this.oebpsDir}/${coverFilename}`;

      // Copy cover image
      try {
        await FileManager.copyFile(localCoverPath, epubCoverPath);
      } catch (copyError) {
        console.error('Failed to copy cover image:', copyError);
        return;
      }

      // Add to images registry with special cover-image property
      const mediaType = getMimeType(coverFilename);
      this.images.push({
        id: 'cover-image',
        src: coverFilename,
        mediaType,
        destinationPath: epubCoverPath,
        originalSrc: coverPath,
      });

      // Create cover XHTML
      const coverXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <meta charset="utf-8"/>
    <title>Cover</title>
    <link rel="stylesheet" type="text/css" href="css/style.css"/>
    <style>
      body { margin: 0; padding: 0; text-align: center; }
      img { max-width: 100%; max-height: 100%; }
    </style>
  </head>
  <body>
    <div id="cover">
      <img src="${coverFilename}" alt="Cover Image"/>
    </div>
  </body>
</html>`;

      await FileManager.writeFile(`${this.oebpsDir}/cover.xhtml`, coverXhtml);

      // Add cover.xhtml to chapters with properties
      this.chapters.unshift({
        id: 'cover',
        href: 'cover.xhtml',
        mediaType: 'application/xhtml+xml',
        title: 'Cover',
        position: -1,
        properties: ['cover-image'],
      });
    } catch (error) {
      console.error('Failed to add cover image:', error);
    }
  }

  /**
   * Create the navigation document
   */
  async createNavigation(): Promise<void> {
    try {
      // Sort chapters by position
      const sortedChapters = [...this.chapters].sort(
        (a, b) => a.position - b.position,
      );

      // Create navigation content
      const navContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <meta charset="utf-8"/>
    <title>Table of Contents</title>
    <link rel="stylesheet" type="text/css" href="css/style.css"/>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Table of Contents</h1>
      <ol class="nav-toc">
        ${sortedChapters
          .filter(chapter => chapter.id !== 'cover') // Exclude cover from TOC
          .map(
            chapter =>
              `<li><a href="${chapter.href}">${escapeXml(
                chapter.title,
              )}</a></li>`,
          )
          .join('\n        ')}
      </ol>
    </nav>
    <nav epub:type="landmarks" id="landmarks">
      <h1>Landmarks</h1>
      <ol class="nav-toc">
        <li><a epub:type="toc" href="#toc">Table of Contents</a></li>
        ${
          this.chapters.find(ch => ch.id === 'cover')
            ? '<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>'
            : ''
        }
        <li><a epub:type="bodymatter" href="${
          sortedChapters.filter(ch => ch.id !== 'cover').length > 0
            ? sortedChapters.filter(ch => ch.id !== 'cover')[0].href
            : '#'
        }">Start of Content</a></li>
      </ol>
    </nav>
  </body>
</html>`;

      // Write the navigation document
      await FileManager.writeFile(`${this.oebpsDir}/nav.xhtml`, navContent);
    } catch (error) {
      console.error('Failed to create navigation document:', error);
      throw new Error(
        `Failed to create navigation: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Create the content.opf package document
   */
  async createPackageDocument(): Promise<void> {
    try {
      // Generate current date in ISO format
      const currentDate = new Date().toISOString().split('T')[0];
      const currentDateTime = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

      // Build manifest items
      const manifestItems = [
        // Navigation document
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        // CSS file
        '<item id="css" href="css/style.css" media-type="text/css"/>',
      ];

      // Add all images to manifest
      this.images.forEach(image => {
        let properties = '';
        if (image.id === 'cover-image') {
          properties = ' properties="cover-image"';
        }
        manifestItems.push(
          `<item id="${image.id}" href="${image.src}" media-type="${image.mediaType}"${properties}/>`,
        );
      });

      // Add all chapters to manifest
      this.chapters.forEach(chapter => {
        let properties = '';
        if (chapter.properties && chapter.properties.length > 0) {
          properties = ` properties="${chapter.properties.join(' ')}"`;
        }
        manifestItems.push(
          `<item id="${chapter.id}" href="${chapter.href}" media-type="${chapter.mediaType}"${properties}/>`,
        );
      });

      // Build spine items (reading order)
      const spineItems = this.chapters
        .sort((a, b) => a.position - b.position)
        .map(chapter => `<itemref idref="${chapter.id}"/>`)
        .join('\n    ');

      // Create package document
      const packageDocument = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${this.options.identifier}</dc:identifier>
    <dc:title>${escapeXml(this.options.title)}</dc:title>
    <dc:language>${this.options.language}</dc:language>
    ${
      this.options.author
        ? `<dc:creator>${escapeXml(this.options.author)}</dc:creator>`
        : ''
    }
    ${
      this.options.publisher
        ? `<dc:publisher>${escapeXml(this.options.publisher)}</dc:publisher>`
        : ''
    }
    <dc:date>${currentDate}</dc:date>
    ${
      this.options.description
        ? `<dc:description>${escapeXml(
            this.options.description,
          )}</dc:description>`
        : ''
    }
    <meta property="dcterms:modified">${currentDateTime}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`;

      // Write package document
      await FileManager.writeFile(
        `${this.oebpsDir}/content.opf`,
        packageDocument,
      );
    } catch (error) {
      console.error('Failed to create package document:', error);
      throw new Error(
        `Failed to create package document: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Finalize and save the EPUB
   */
  async save(): Promise<string> {
    try {
      // Create navigation
      await this.createNavigation();

      // Create package document
      await this.createPackageDocument();

      // Ensure output directory exists
      const outputDir = this.outputFile.substring(
        0,
        this.outputFile.lastIndexOf('/'),
      );
      await FileManager.mkdir(outputDir);

      // Create the EPUB ZIP
      const files = await this.getAllEpubFiles();
      await this.createEpubZip(files);

      // Remove temp files
      await this.cleanup();

      return this.outputFile;
    } catch (error) {
      console.error('Failed to save EPUB:', error);
      throw new Error(
        `Failed to save EPUB: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Get all files that need to be included in the EPUB
   */
  private async getAllEpubFiles(): Promise<
    { path: string; relativePath: string }[]
  > {
    // Helper function to recursively list all files in a directory
    const listFilesRecursively = async (
      dir: string,
      baseDir: string,
    ): Promise<{ path: string; relativePath: string }[]> => {
      const result: { path: string; relativePath: string }[] = [];

      try {
        const items = await FileManager.readDir(dir);

        for (const item of items) {
          const fullPath = item.path;
          const relativePath = fullPath.replace(baseDir + '/', '');

          if (item.isDirectory) {
            // Recursively process directories
            const subDirFiles = await listFilesRecursively(fullPath, baseDir);
            result.push(...subDirFiles);
          } else {
            // Add file with its relative path
            result.push({
              path: fullPath,
              relativePath,
            });
          }
        }
      } catch (error) {
        console.error(`Error listing files in ${dir}:`, error);
      }

      return result;
    };

    return await listFilesRecursively(this.workDir, this.workDir);
  }

  /**
   * Create EPUB zip file with proper structure
   * This is a replacement for the missing FileManager.zipDirectory function
   */
  private async createEpubZip(
    files: { path: string; relativePath: string }[],
  ): Promise<void> {
    try {
      // For proper EPUB creation, the mimetype file must be first and uncompressed
      // We'll prepare all files in a proper structure and use zip function

      // First find the mimetype file
      const mimetypeFile = files.find(f => f.relativePath === 'mimetype');

      if (!mimetypeFile) {
        throw new Error('mimetype file not found in EPUB structure');
      }

      // Create a temporary file to include in the report
      const reportContent =
        `EPUB file created with ${files.length} files\n\n` +
        'Files included in the EPUB:\n' +
        files.map((f, i) => `${i + 1}. ${f.relativePath}`).join('\n');

      // Write report file for debugging
      const reportPath = `${this.workDir}/../epub_report_${Date.now()}.txt`;
      await FileManager.writeFile(reportPath, reportContent);

      // Use the zip function from react-native-zip-archive
      // This will zip a directory, not individual files
      // So we rely on our directory structure being correct
      await zip(this.workDir, this.outputFile);

      console.log(
        `EPUB created at ${this.outputFile} with ${files.length} files`,
      );

      return;
    } catch (error) {
      console.error('Error creating EPUB ZIP:', error);
      throw error;
    }
  }

  /**
   * Cleanup temporary files
   */
  async cleanup(): Promise<void> {
    try {
      // Since FileManager.deleteRecursive is not available, use our own implementation
      await this.deleteDirectoryRecursive(this.workDir);
    } catch (error) {
      console.error('Error cleaning up EPUB temp files:', error);
    }
  }

  /**
   * Delete a directory recursively
   * This is a replacement for the missing FileManager.deleteRecursive function
   */
  private async deleteDirectoryRecursive(dirPath: string): Promise<void> {
    try {
      const items = await FileManager.readDir(dirPath);

      // First delete all files and subdirectories
      for (const item of items) {
        const itemPath = item.path;

        if (item.isDirectory) {
          // Recursively delete subdirectory
          await this.deleteDirectoryRecursive(itemPath);
        } else {
          // Delete file
          await FileManager.unlink(itemPath);
        }
      }

      // Then delete the empty directory
      await FileManager.unlink(dirPath);
    } catch (error) {
      console.error(`Error deleting directory ${dirPath}:`, error);
      throw error;
    }
  }

  /**
   * Cancel EPUB creation and clean up
   */
  async cancel(): Promise<void> {
    await this.cleanup();
  }
}

/**
 * Helper function to create EPUB from novel chapters
 */
export const createNovelEpub = async (
  novel: NovelInfo,
  chapters: ChapterInfo[],
  outputPath: string,
  options?: {
    embedImages?: boolean;
    stylesheet?: string;
    useTranslatedContent?: boolean;
    useChapterNumberOnlyTitle?: boolean;
  },
): Promise<string> => {
  const epub = new EpubPackage(
    {
      title: novel.name,
      author: novel.author || 'Unknown Author',
      description: novel.summary,
      coverPath: novel.cover,
      pluginId: novel.pluginId,
      embedImages: options?.embedImages || false,
      stylesheet: options?.stylesheet,
      useTranslatedContent: options?.useTranslatedContent || false,
      useChapterNumberOnlyTitle: options?.useChapterNumberOnlyTitle || false,
    },
    outputPath,
  );

  try {
    await epub.prepare();

    // Add cover image if available
    if (novel.cover) {
      let coverPath = novel.cover;
      let coverFound = false;

      // Try several potential cover locations
      const potentialCoverPaths = [
        novel.cover, // Original path
        `${NOVEL_STORAGE}/${novel.pluginId}/${novel.id}/cover.png`,
        `${NOVEL_STORAGE}/${novel.pluginId}/${novel.id}/cover.jpg`,
        `/storage/emulated/0/Android/data/com.rajarsheechatterjee.LNReader.debug/files/Novels/${novel.pluginId}/${novel.id}/cover.png`,
        `/storage/emulated/0/Android/data/com.rajarsheechatterjee.LNReader/files/Novels/${novel.pluginId}/${novel.id}/cover.png`,
      ];

      // Check if it's an HTTP URL - need to download
      if (novel.cover.startsWith('http')) {
        const coverFilename = novel.cover.split('/').pop() || 'cover.jpg';
        coverPath = `${FileManager.ExternalCachesDirectoryPath}/${coverFilename}`;

        try {
          if (!(await FileManager.exists(coverPath))) {
            await FileManager.downloadFile(novel.cover, coverPath, 'GET', {});
          }
          coverFound = true;
        } catch (error) {
          console.warn(
            `Error downloading cover from URL ${novel.cover}:`,
            error,
          );
          // Continue - will try local paths
        }
      }

      // If not found and not already downloaded, try local paths
      if (!coverFound) {
        for (const path of potentialCoverPaths) {
          if (path && (await FileManager.exists(path))) {
            coverPath = path;
            coverFound = true;
            console.log('Found novel cover at:', coverPath);
            break;
          }
        }
      }

      if (coverFound) {
        await epub.addCoverImage(coverPath);
      } else {
        console.warn('Could not find a valid cover for novel:', novel.name);
      }
    }

    // Sort chapters by position or chapterNumber if available
    const sortedChapters = [...chapters].sort((a, b) => {
      // Use position if available
      if (a.position !== undefined && b.position !== undefined) {
        return a.position - b.position;
      }
      // Fall back to chapterNumber
      if (a.chapterNumber !== undefined && b.chapterNumber !== undefined) {
        return a.chapterNumber - b.chapterNumber;
      }
      // Default to ID comparison
      return a.id - b.id;
    });

    // Add each chapter
    for (let i = 0; i < sortedChapters.length; i++) {
      const chapter = sortedChapters[i];
      // Prioritize translated name if available and requested
      const baseChapterTitle =
        options?.useTranslatedContent && chapter.translatedName?.trim()
          ? chapter.translatedName.trim()
          : chapter.name?.trim();

      const chapterTitle =
        baseChapterTitle || `Chapter ${chapter.chapterNumber || i + 1}`;

      let finalChapterTitle = chapterTitle;

      // Optionally use only chapter number
      if (options?.useChapterNumberOnlyTitle) {
        const numberMatch = chapterTitle.match(/\d+(\.\d+)?/);
        if (numberMatch) {
          finalChapterTitle = `Chapter ${numberMatch[0]}`;
        } else if (chapter.chapterNumber !== undefined) {
          finalChapterTitle = `Chapter ${chapter.chapterNumber}`;
        } else {
          // Fallback if no number found
          finalChapterTitle = `Chapter ${i + 1}`;
        }
      }

      let chapterContentToUse: string | null = null;
      let usedTranslation = false;

      // Try using translation if requested and available
      if (options?.useTranslatedContent) {
        try {
          const translation = await getTranslation(chapter.id);
          if (translation?.content) {
            chapterContentToUse = translation.content;
            usedTranslation = true;
          }
        } catch (translationError) {
          console.warn(
            `Error fetching translation for chapter ${chapter.id}:`,
            translationError,
          );
        }
      }

      // If translation wasn't used or found, use original content
      if (!usedTranslation) {
        const filePath = `${NOVEL_STORAGE}/${novel.pluginId}/${novel.id}/${chapter.id}/index.html`;
        const fileExists = await FileManager.exists(filePath);

        if (fileExists) {
          chapterContentToUse = await FileManager.readFile(filePath);
        } else {
          // File not found, chapterContentToUse remains null
        }
      }

      // Add chapter to EPUB only if we have content
      if (chapterContentToUse !== null) {
        await epub.addChapter(finalChapterTitle, chapterContentToUse, i);
      }
    }

    // Save the EPUB
    const epubFilePath = await epub.save();
    showToast(`EPUB created: ${epubFilePath}`);
    return epubFilePath;
  } catch (error) {
    console.error('Error creating EPUB:', error);
    showToast(
      `EPUB creation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
    await epub.cancel();
    throw error;
  }
};

/**
 * Helper function to create EPUB from translation content
 */
export const createTranslationEpub = async (
  translations: TranslationInfo[],
  novelTitle: string,
  outputPath: string,
  options?: {
    coverPath?: string;
    embedImages?: boolean;
    stylesheet?: string;
  },
): Promise<string> => {
  // Group by novel ID to ensure we're dealing with a single novel
  const groupedByNovelId = translations.reduce((groups, translation) => {
    const novelId = translation.novelId;
    if (!groups[novelId]) {
      groups[novelId] = [];
    }
    groups[novelId].push(translation);
    return groups;
  }, {} as Record<number, TranslationInfo[]>);

  // We should have only one novel ID group, but just in case, use the first one
  const novelId = Object.keys(groupedByNovelId)[0];
  const translationGroup = groupedByNovelId[Number(novelId)];

  // Get the first translation for basic novel info
  const firstTranslation = translationGroup[0];

  const epub = new EpubPackage(
    {
      title: novelTitle,
      author: 'Unknown Author', // Translation data doesn't typically include author
      description: `Translated content for ${novelTitle}`,
      coverPath: options?.coverPath || firstTranslation.novelCover,
      pluginId: firstTranslation.novelPluginId,
      embedImages: options?.embedImages || false,
      stylesheet: options?.stylesheet,
    },
    outputPath,
  );

  try {
    await epub.prepare();

    // Add cover image if available
    const coverPath = options?.coverPath || firstTranslation.novelCover;
    if (coverPath) {
      let localCoverPath = coverPath;

      // Download cover if it's a URL
      if (coverPath.startsWith('http')) {
        const coverFilename = coverPath.split('/').pop() || 'cover.jpg';
        localCoverPath = `${FileManager.ExternalCachesDirectoryPath}/${coverFilename}`;
        await FileManager.downloadFile(coverPath, localCoverPath, 'GET', {});
      }

      await epub.addCoverImage(localCoverPath);
    }

    // Sort translations (usually by chapter order)
    const sortedTranslations = [...translationGroup].sort((a, b) => {
      // Extract chapter numbers if possible
      const aMatch = a.chapterTitle?.match(/\d+/);
      const bMatch = b.chapterTitle?.match(/\d+/);

      if (aMatch && bMatch) {
        return parseInt(aMatch[0]) - parseInt(bMatch[0]);
      }

      // Fall back to alphabetical by title
      return a.chapterTitle.localeCompare(b.chapterTitle);
    });

    // Add each chapter
    for (let i = 0; i < sortedTranslations.length; i++) {
      const translation = sortedTranslations[i];
      const chapterTitle = translation.chapterTitle || `Chapter ${i + 1}`;

      await epub.addChapter(chapterTitle, translation.content, i);
    }

    // Save the EPUB
    const epubFilePath = await epub.save();
    showToast(`EPUB created: ${epubFilePath}`);
    return epubFilePath;
  } catch (error) {
    console.error('Error creating translation EPUB:', error);
    showToast(
      `EPUB creation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
    await epub.cancel();
    throw error;
  }
};
