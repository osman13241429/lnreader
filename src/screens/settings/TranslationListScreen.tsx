import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Platform, SafeAreaView, StyleSheet, ToastAndroid, View, TouchableOpacity, Switch } from 'react-native';
import { ActivityIndicator, Button, Card, Checkbox, Chip, Divider, FAB, IconButton, List, Portal, Text, useTheme, SegmentedButtons } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { deleteAllTranslations, deleteTranslation, getAllTranslations, getAllTranslationsByNovel } from '@database/queries/TranslationQueries';
import FileManager from '@native/FileManager';
import { useTranslateBatch } from '@hooks';
import { batchTranslateChapters } from '@services/translation/BatchTranslationService';
import { useTranslationSettings } from '@hooks/persisted/useSettings';
import { NOVEL_STORAGE } from '@utils/Storages';
import { parseChapterNumber } from '@utils/parseChapterNumber';

type ViewMode = 'flat' | 'grouped';
type ExportFormat = 'txt' | 'html' | 'epub';
type ExportMode = 'single' | 'multiple';

// Simple date formatter function
const formatDate = (date: Date): string => {
  try {
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  } catch (error) {
    return 'Invalid date';
  }
};

const TranslationListScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation();
  const [translations, setTranslations] = useState<any[]>([]);
  const [groupedTranslations, setGroupedTranslations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedItems, setExpandedItems] = useState<{ [key: number]: boolean }>({});
  const [viewMode, setViewMode] = useState<ViewMode>('grouped');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<{ [key: number]: boolean }>({});
  const [hasSelectedItems, setHasSelectedItems] = useState(false);
  const [initialRenderForced, setInitialRenderForced] = useState(false);
  const [selectedNovels, setSelectedNovels] = useState<{ [key: number]: boolean }>({});
  const [exportFormat, setExportFormat] = useState<ExportFormat>('txt');
  const [exportMode, setExportMode] = useState<ExportMode>('multiple');
  const [openFab, setOpenFab] = useState(false);
  const { translateChapters } = useTranslateBatch();
  // Get translation settings at component level
  const { apiKey, defaultInstruction, model } = useTranslationSettings();

  // Define loadTranslations first, before it's used in useEffect
  const loadTranslations = useCallback(async () => {
    setLoading(true);
    try {
      // Load both flat and grouped translations
      const translationsData = await getAllTranslations();
      const groupedData = await getAllTranslationsByNovel();
      
      console.log("Loaded translations:", translationsData?.length || 0);
      console.log("Loaded grouped translations:", groupedData?.length || 0);
      
      // Ensure we have valid data
      if (translationsData) {
        setTranslations(translationsData);
      } else {
        setTranslations([]);
      }
      
      // Ensure each item in groupedData has a chapters array
      if (groupedData && Array.isArray(groupedData)) {
        const safeGroupedData = groupedData.map(novel => ({
          ...novel,
          chapters: novel.chapters || [],
        }));
        console.log("Safe grouped data:", safeGroupedData.length);
        setGroupedTranslations(safeGroupedData);
      } else {
        setGroupedTranslations([]);
      }
    } catch (error) {
      console.error('Error loading translations', error);
      setTranslations([]);
      setGroupedTranslations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Setup effect hooks after loadTranslations is defined
  useEffect(() => {
    navigation.setOptions({
      title: "Translation List",
    });
    // Initial load of translations
    loadTranslations();
  }, [navigation, loadTranslations]);

  // Reset view mode if empty content in the current mode - with guard against loops
  useEffect(() => {
    if (!loading) {
      if (viewMode === 'grouped' && groupedTranslations.length === 0 && translations.length > 0) {
        console.log("Switching to flat view because grouped view is empty");
        setViewMode('flat');
      }
    }
  }, [loading, viewMode, translations.length, groupedTranslations.length]);

  useEffect(() => {
    const hasItemsSelected = selectedItems && Object.values(selectedItems).some(val => val === true);
    const hasNovelsSelected = selectedNovels && Object.values(selectedNovels).some(val => val === true);
    setHasSelectedItems(!!hasItemsSelected || !!hasNovelsSelected);
  }, [selectedItems, selectedNovels]);

  // One-time fix for initial render
  useEffect(() => {
    if (!loading && !initialRenderForced && 
        ((viewMode === 'flat' && translations.length > 0) || 
         (viewMode === 'grouped' && groupedTranslations.length > 0))) {
      
      console.log("Doing one-time forced render to fix initial display");
      setInitialRenderForced(true);
      setViewMode(curr => curr); // Simple re-render
    }
  }, [loading, initialRenderForced, translations.length, groupedTranslations.length, viewMode]);

  const handleDeleteTranslation = useCallback(async (chapterId: number) => {
    try {
      await deleteTranslation(chapterId);
      // Reload translations after deletion
      loadTranslations();
    } catch (error) {
      console.error('Failed to delete translation', error);
    }
  }, [loadTranslations]);

  const confirmDeleteTranslation = useCallback((chapterId: number) => {
    Alert.alert(
      "Delete",
      "Are you sure you want to delete this translation?",
      [
        { text: "Cancel", style: 'cancel' },
        { 
          text: "Delete", 
          style: 'destructive',
          onPress: () => handleDeleteTranslation(chapterId)
        },
      ]
    );
  }, [handleDeleteTranslation]);

  const confirmDeleteAllTranslations = useCallback(() => {
    Alert.alert(
      "Delete All",
      "Delete all translations? This cannot be undone.",
      [
        { text: "Cancel", style: 'cancel' },
        { 
          text: "Delete", 
          style: 'destructive',
          onPress: async () => {
            await deleteAllTranslations();
            loadTranslations();
            setSelectedItems({});
          }
        },
      ]
    );
  }, [loadTranslations]);

  // Helper function to process HTML content - preserve images and structure
  const processHtmlContent = useCallback((html: string, novelName: string) => {
    try {
      // If content is not HTML, just return it as plain text
      if (!html.includes('<')) {
        return { content: html, css: '' };
      }

      // Extract any existing CSS
      let css = '';
      const cssRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
      const cssMatch = cssRegex.exec(html);
      if (cssMatch && cssMatch[1]) {
        css = `<style>${cssMatch[1]}</style>`;
      }

      // Get just the body content if it's a full HTML document
      let content = html;
      if (html.includes('<body')) {
        const bodyRegex = /<body[^>]*>([\s\S]*?)<\/body>/i;
        const bodyMatch = bodyRegex.exec(html);
        if (bodyMatch && bodyMatch[1]) {
          content = bodyMatch[1];
        }
      }

      // For TXT export, convert to plain text by removing HTML tags
      if (exportFormat === 'txt') {
        // Replace common HTML entities
        content = content
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        
        // Replace <br>, <p>, and other block elements with newlines
        content = content
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<\/div>/gi, '\n')
          .replace(/<\/h[1-6]>/gi, '\n\n');
        
        // Remove all remaining HTML tags
        content = content.replace(/<[^>]*>/g, '');
        
        // Remove excessive newlines
        content = content.replace(/\n{3,}/g, '\n\n');
        
        // Add novel name as title
        content = `${novelName}\n\n${content}`;
      }

      return { content, css };
    } catch (error) {
      console.error('HTML processing error:', error);
      return { content: html, css: '' };
    }
  }, [exportFormat]);

  // Export function with per-novel folders
  const exportTranslation = useCallback(async (translation: any) => {
    if (!translation || (!translation.content && !translation.previewText)) {
      console.error('Export error: No content to export', translation);
      Alert.alert('Error', 'No content to export');
      return false;
    }

    try {
      // Get novel and chapter info
      const novelName = translation.novelName || translation.novelTitle || 'Unknown Novel';
      const chapterName = translation.chapterName || translation.chapterTitle || 'Unknown Chapter';
      
      // Debug object properties
      console.log('EXPORT DEBUG - Translation object keys:', Object.keys(translation));
      console.log('EXPORT DEBUG - Content available:', !!translation.content, 'Preview available:', !!translation.previewText);
      console.log('EXPORT DEBUG - Content length:', translation.content?.length || 0, 'Preview length:', translation.previewText?.length || 0);
      
      // Sanitize names for folder/file creation
      const sanitizedNovelName = novelName.replace(/[/\\?%*:|"<>]/g, '-');
      const sanitizedChapterName = chapterName.replace(/[/\\?%*:|"<>]/g, '-');
      
      // Generate timestamp for unique filenames
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Set up paths with per-novel folders
      const baseDir = '/storage/emulated/0/Download/LNReader';
      const novelDir = `${baseDir}/${sanitizedNovelName}`;
      
      console.log('EXPORT DEBUG - Base directory:', baseDir);
      console.log('EXPORT DEBUG - Novel directory:', novelDir);
      
      // Create directories with logging
      console.log('EXPORT DEBUG - Creating base directory...');
      await FileManager.mkdir(baseDir);
      console.log('EXPORT DEBUG - Base directory created or exists');
      
      console.log('EXPORT DEBUG - Creating novel directory...');
      await FileManager.mkdir(novelDir);
      console.log('EXPORT DEBUG - Novel directory created or exists');
      
      // Content to export
      const contentToExport = translation.content || translation.previewText || '';
      console.log('EXPORT DEBUG - Content length to export:', contentToExport.length);
      console.log('EXPORT DEBUG - First 50 chars of content:', contentToExport.substring(0, 50));
      
      // Check if content is empty
      if (!contentToExport || contentToExport.trim() === '') {
        console.error('EXPORT DEBUG - Content is empty, nothing to write');
        return false;
      }
      
      // Process the content based on the export format
      const { content: processedContent, css: extractedCSS } = processHtmlContent(contentToExport, sanitizedNovelName);
      
      // Find all images in the content and extract their paths
      const imagePaths: {original: string, target: string}[] = [];
      if (exportFormat !== 'txt') {
        // Extract file:// image paths from the content
        const imgRegex = /<img\s+[^>]*src\s*=\s*['"]file:\/\/([^'"]+)['"]/gi;
        let match;
        while ((match = imgRegex.exec(contentToExport)) !== null) {
          if (match[1]) {
            const originalPath = match[1];
            const fileName = originalPath.split('/').pop() || 'image.png';
            const targetDir = `${novelDir}/images`;
            const targetPath = `${targetDir}/${fileName}`;
            
            imagePaths.push({
              original: originalPath,
              target: targetPath
            });
          }
        }
        
        // Create images directory
        if (imagePaths.length > 0) {
          await FileManager.mkdir(`${novelDir}/images`);
          console.log(`Created images directory for ${imagePaths.length} images`);
        }
      }
      
      // Determine export format and filename - adding timestamp to ensure uniqueness
      let filename: string = '';
      let fullPath: string = '';
      
      if (exportFormat === 'txt') {
        filename = `${sanitizedChapterName}-${timestamp}.txt`;
        fullPath = `${novelDir}/${filename}`;
        
        console.log('EXPORT DEBUG - Full file path (TXT):', fullPath);
        
        // Check if the file exists and handle it
        if (await FileManager.exists(fullPath)) {
          console.log(`EXPORT DEBUG - File already exists, will overwrite: ${fullPath}`);
        }
        
        // Write TXT file
        console.log('EXPORT DEBUG - Writing TXT file...');
        try {
          await FileManager.writeFile(fullPath, processedContent);
          console.log('EXPORT DEBUG - File write operation completed');
        } catch (writeError) {
          console.error('EXPORT DEBUG - Error writing file:', writeError);
          
          // If failed due to file existing, try with a different timestamp
          const retryTimestamp = Date.now().toString();
          const retryFilename = `${sanitizedChapterName}-${retryTimestamp}.txt`;
          const retryPath = `${novelDir}/${retryFilename}`;
          
          console.log(`EXPORT DEBUG - Retrying with different filename: ${retryPath}`);
          await FileManager.writeFile(retryPath, processedContent);
          
          // Update the filename for logging
          filename = retryFilename;
          fullPath = retryPath;
        }
      } else if (exportFormat === 'html') {
        // HTML format
        filename = `${sanitizedChapterName}-${timestamp}.html`;
        fullPath = `${novelDir}/${filename}`;
        
        console.log('EXPORT DEBUG - Full file path (HTML):', fullPath);
        
        // Check if the file exists and handle it
        if (await FileManager.exists(fullPath)) {
          console.log(`EXPORT DEBUG - File already exists, will overwrite: ${fullPath}`);
          try {
            await FileManager.unlink(fullPath);
          } catch (error) {
            console.error(`EXPORT DEBUG - Could not delete existing file: ${error}`);
            // Continue anyway, as we'll try to overwrite or use a different name
          }
        }
        
        // Create HTML file with proper styling
        let htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>${novelName} - ${chapterName}</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* Base styling for exported content */
    :root {
      --text-color: #333;
      --background-color: #fff;
      --link-color: #0066cc;
      --heading-color: #444;
      --border-color: #eee;
    }
    
    @media (prefers-color-scheme: dark) {
      :root {
        --text-color: #e0e0e0;
        --background-color: #121212;
        --link-color: #64b5f6;
        --heading-color: #bbdefb;
        --border-color: #333;
      }
    }

    body {
      font-family: 'Noto Serif', serif;
      line-height: 1.6;
      margin: 0 auto;
      padding: 2em;
      max-width: 40em;
      color: var(--text-color);
      background-color: var(--background-color);
    }
    
    h1, h2, h3 {
      text-align: center;
      margin-top: 1em;
      margin-bottom: 1em;
      color: var(--heading-color);
    }
    
    h1 {
      font-size: 1.8em;
      margin-top: 2em;
    }
    
    h2 {
      font-size: 1.5em;
    }
    
    h3 {
      font-size: 1.3em;
      text-align: left;
    }
    
    p {
      margin-bottom: 1em;
      text-indent: 1.5em;
    }
    
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 1em auto;
      border-radius: 4px;
    }
    
    a {
      color: var(--link-color);
      text-decoration: none;
    }
    
    a:hover {
      text-decoration: underline;
    }
    
    .cover {
      text-align: center;
      margin-bottom: 3em;
    }
    
    .chapter {
      margin-top: 3em;
      border-top: 1px solid var(--border-color);
      padding-top: 2em;
    }
    
    .chapter-content {
      line-height: 1.8;
      white-space: pre-wrap;
    }
  </style>
  ${extractedCSS}
</head>
<body>
  <div class="cover">
    <h1>${novelName}</h1>
    <h2>${chapterName}</h2>
  </div>
  <div class="chapter-content">
    ${processedContent}
  </div>
</body>
</html>`;
        
        // Write HTML file
        console.log('EXPORT DEBUG - Writing HTML file...');
        try {
          await FileManager.writeFile(fullPath, htmlContent);
          console.log('EXPORT DEBUG - HTML file write operation completed');
        } catch (writeError) {
          console.error('EXPORT DEBUG - Error writing HTML file:', writeError);
          
          // Try with a different filename
          const retryTimestamp = Date.now().toString();
          const retryFilename = `${sanitizedChapterName}-${retryTimestamp}.html`;
          const retryPath = `${novelDir}/${retryFilename}`;
          
          console.log(`EXPORT DEBUG - Retrying with different HTML filename: ${retryPath}`);
          await FileManager.writeFile(retryPath, htmlContent);
          
          // Update the filename for logging
          filename = retryFilename;
          fullPath = retryPath;
        }
      } else if (exportFormat === 'epub') {
        // EPUB format (simplified version, actual EPUB would need more implementation)
        // Since creating a proper EPUB requires more complex code and dependencies
        // we'll create an HTML file that has an .epub extension as a placeholder
        // In a full implementation, a proper EPUB library would be used
        
        filename = `${sanitizedChapterName}-${timestamp}.epub`;
        fullPath = `${novelDir}/${filename}`;
        
        // Check if file exists and handle accordingly
        if (await FileManager.exists(fullPath)) {
          console.log(`EXPORT DEBUG - EPUB file already exists, will overwrite: ${fullPath}`);
          try {
            await FileManager.unlink(fullPath);
          } catch (error) {
            console.error(`EXPORT DEBUG - Could not delete existing EPUB file: ${error}`);
            // Generate new filename with more unique timestamp
            const uniqueTimestamp = Date.now().toString();
            filename = `${sanitizedChapterName}-${uniqueTimestamp}.epub`;
            fullPath = `${novelDir}/${filename}`;
          }
        }
        
        // Create a simpler version of HTML content for EPUB
        // For proper EPUB, a library like epub-gen would be needed
        Alert.alert(
          "EPUB Format", 
          "Full EPUB generation would require additional libraries. Creating HTML with EPUB extension for now.",
          [{ text: "OK" }]
        );
        
        // Use the same HTML template as HTML format
        let htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>${novelName} - ${chapterName}</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: 'Noto Serif', serif;
      line-height: 1.6;
      margin: 2em;
    }
    h1, h2 { text-align: center; }
    img { max-width: 100%; height: auto; }
  </style>
  ${extractedCSS}
</head>
<body>
  <h1>${novelName}</h1>
  <h2>${chapterName}</h2>
  <div>
    ${processedContent}
  </div>
</body>
</html>`;
        
        // Write EPUB file (actually HTML with .epub extension)
        try {
          await FileManager.writeFile(fullPath, htmlContent);
          console.log('EXPORT DEBUG - EPUB file write operation completed');
        } catch (writeError) {
          console.error('EXPORT DEBUG - Error writing EPUB file:', writeError);
          
          // Try with an even more unique filename
          const retryTimestamp = Date.now().toString() + Math.floor(Math.random() * 1000);
          const retryFilename = `${sanitizedChapterName}-${retryTimestamp}.epub`;
          const retryPath = `${novelDir}/${retryFilename}`;
          
          console.log(`EXPORT DEBUG - Retrying with different EPUB filename: ${retryPath}`);
          await FileManager.writeFile(retryPath, htmlContent);
          
          // Update filename for logging
          filename = retryFilename;
          fullPath = retryPath;
        }
      }
      
      // Copy all images to the export directory
      if (imagePaths.length > 0) {
        console.log(`Copying ${imagePaths.length} images for export...`);
        for (const image of imagePaths) {
          try {
            if (await FileManager.exists(image.original)) {
              await FileManager.copyFile(image.original, image.target);
              console.log(`Copied image from ${image.original} to ${image.target}`);
            } else {
              console.warn(`Image file not found: ${image.original}`);
            }
          } catch (error) {
            console.error(`Failed to copy image: ${error}`);
          }
        }
      }
      
      console.log(`Successfully exported: ${novelName}/${filename}`);
      
      return true;
    } catch (error: any) {
      console.error('EXPORT DEBUG - Export error details:', error);
      console.error('EXPORT DEBUG - Error message:', error.message);
      console.error('EXPORT DEBUG - Error stack:', error.stack);
      
      // More specific error handling
      if (error.message) {
        if (error.message.includes('Permission') || error.message.includes('EACCES') || error.message.includes('access')) {
          console.error('EXPORT DEBUG - Permission error detected');
          Alert.alert(
            'Storage Permission Error', 
            'Unable to write to storage. Please check app permissions in Settings.'
          );
        } else if (error.message.includes('ENOENT')) {
          console.error('EXPORT DEBUG - File or directory not found error');
          Alert.alert(
            'Export Error',
            'Directory could not be created. Please check storage permissions.'
          );
        } else if (error.message.includes('ENOSPC')) {
          console.error('EXPORT DEBUG - No space left on device');
          Alert.alert(
            'Export Error',
            'No space left on device to save the export.'
          );
        } else if (error.message.includes('EEXIST')) {
          console.error('EXPORT DEBUG - File already exists error');
          Alert.alert(
            'Export Error',
            'File already exists. Please try again with a different name or delete the existing file first.'
          );
        }
      }
      
      return false;
    }
  }, [exportFormat, processHtmlContent]);

  // Export multiple chapters into a single file with index
  const exportCombinedFile = useCallback(async (novel: any, chapters: any[]) => {
    try {
      if (!novel || !chapters || chapters.length === 0) {
        console.error('EXPORT DEBUG - Combined export: Invalid parameters', { novel, chapterCount: chapters?.length });
        Alert.alert('Error', 'No chapters to export');
        return false;
      }

      // Get novel info and sanitize for filenames
      const novelName = novel.novelTitle || 'Unknown Novel';
      const sanitizedNovelName = novelName.replace(/[/\\?%*:|"<>]/g, '-');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Debug
      console.log('EXPORT DEBUG - Combined export started', {
        novel: novelName,
        chapterCount: chapters.length,
        format: exportFormat
      });
      
      // Set up directory structure
      const baseDir = '/storage/emulated/0/Download/LNReader';
      const novelDir = `${baseDir}/${sanitizedNovelName}`;
      
      // Create directories
      console.log('EXPORT DEBUG - Creating base directory...');
      await FileManager.mkdir(baseDir);
      console.log('EXPORT DEBUG - Creating novel directory...');
      await FileManager.mkdir(novelDir);
      
      // Load all chapter contents with error handling
      const loadedChapters = [];
      for (const chapter of chapters) {
        try {
          const chapterContent = chapter.content || chapter.previewText;
          if (chapterContent && chapterContent.trim() !== '') {
            const chapterTitle = chapter.chapterTitle || chapter.chapterName || 'Untitled Chapter';
            loadedChapters.push({
              title: chapterTitle,
              content: chapterContent,
              id: chapter.id || chapter.chapterId,
              chapterNumber: parseChapterNumber(novelName, chapterTitle)
            });
          } else {
            console.warn(`Chapter ${chapter.id || chapter.chapterId} has no content, skipping`);
          }
        } catch (error) {
          console.error(`Error loading chapter ${chapter.id}:`, error);
        }
      }
      
      console.log(`EXPORT DEBUG - Successfully loaded ${loadedChapters.length} of ${chapters.length} chapters`);
      
      if (loadedChapters.length === 0) {
        Alert.alert('Error', 'No content available for export');
        return false;
      }
      
      // Sort chapters by chapter number
      loadedChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
      console.log(`EXPORT DEBUG - Chapters sorted by chapter number`);
      
      // Handle different export formats
      if (exportFormat === 'txt') {
        // For TXT format, just concatenate all chapters with headers
        let combinedContent = `${novelName}\n\n`;
        
        // Create a simple table of contents
        combinedContent += "TABLE OF CONTENTS\n\n";
        loadedChapters.forEach((chapter, index) => {
          combinedContent += `${index + 1}. ${chapter.title}\n`;
        });
        combinedContent += "\n\n";
        
        // Add each chapter with a divider
        loadedChapters.forEach((chapter, index) => {
          // Process the content to strip HTML
          const { content: processedContent } = processHtmlContent(chapter.content, novelName);
          
          combinedContent += `CHAPTER ${index + 1}: ${chapter.title}\n\n`;
          combinedContent += `${processedContent}\n\n`;
          combinedContent += "--------------------\n\n";
        });
        
        // Create a unique filename with timestamp
        const filename = `${sanitizedNovelName}-combined-${timestamp}.txt`;
        const fullPath = `${novelDir}/${filename}`;
        
        // Check if file exists and delete it if necessary
        if (await FileManager.exists(fullPath)) {
          console.log(`EXPORT DEBUG - File already exists, will overwrite: ${fullPath}`);
          try {
            await FileManager.unlink(fullPath);
          } catch (error) {
            console.error(`EXPORT DEBUG - Could not delete existing file: ${error}`);
            // Generate new filename with different timestamp
            const uniqueTimestamp = Date.now().toString();
            const uniqueFilename = `${sanitizedNovelName}-combined-${uniqueTimestamp}.txt`;
            const uniquePath = `${novelDir}/${uniqueFilename}`;
            await FileManager.writeFile(uniquePath, combinedContent);
            console.log(`EXPORT DEBUG - Exported to alternate file: ${uniqueFilename}`);
            return true;
          }
        }
        
        // Write to file
        await FileManager.writeFile(fullPath, combinedContent);
        console.log(`EXPORT DEBUG - Combined export successful: ${filename}`);
        return true;
      } 
      else {
        // For HTML and EPUB, create a styled document with chapters
        let tableOfContents = '';
        let chapterContents = '';
        let extractedCSS = '';
        
        // Process each chapter and build the content
        loadedChapters.forEach((chapter, index) => {
          const chapterNum = index + 1;
          const anchorId = `chapter-${chapterNum}`;
          
          // Add entry to table of contents
          tableOfContents += `<li><a href="#${anchorId}">${chapter.title}</a></li>\n`;
          
          // Process the chapter content, preserving HTML
          const { content: processedContent, css } = processHtmlContent(chapter.content, novelName);
          
          // Collect all CSS
          if (css && !extractedCSS.includes(css)) {
            extractedCSS += css;
          }
          
          // Add chapter content with proper styling
          chapterContents += `
<div id="${anchorId}" class="chapter">
  <h2>Chapter ${chapterNum}: ${chapter.title}</h2>
  <div class="chapter-content">
    ${processedContent}
  </div>
</div>`;
        });
        
        // Create full HTML document
        let htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>${novelName}</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* Base styling for exported content */
    :root {
      --text-color: #333;
      --background-color: #fff;
      --link-color: #0066cc;
      --heading-color: #444;
      --border-color: #eee;
    }
    
    @media (prefers-color-scheme: dark) {
      :root {
        --text-color: #e0e0e0;
        --background-color: #121212;
        --link-color: #64b5f6;
        --heading-color: #bbdefb;
        --border-color: #333;
      }
    }

    body {
      font-family: 'Noto Serif', serif;
      line-height: 1.6;
      margin: 0 auto;
      padding: 2em;
      max-width: 40em;
      color: var(--text-color);
      background-color: var(--background-color);
    }
    
    h1, h2, h3 {
      text-align: center;
      margin-top: 1em;
      margin-bottom: 1em;
      color: var(--heading-color);
    }
    
    h1 {
      font-size: 2em;
      margin-top: 2em;
    }
    
    h2 {
      font-size: 1.8em;
    }
    
    .toc {
      margin: 2em 0;
      padding: 1em;
      background-color: rgba(0,0,0,0.05);
      border-radius: 4px;
    }
    
    .toc h3 {
      margin-top: 0;
    }
    
    .toc ul {
      padding-left: 2em;
    }
    
    .toc a {
      color: var(--link-color);
      text-decoration: none;
    }
    
    .toc a:hover {
      text-decoration: underline;
    }
    
    .chapter {
      margin-top: 3em;
      border-top: 1px solid var(--border-color);
      padding-top: 2em;
    }
    
    .chapter-content {
      line-height: 1.8;
    }
    
    .chapter-content p {
      margin-bottom: 1em;
      text-indent: 1.5em;
    }
    
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 1em auto;
    }
  </style>
  ${extractedCSS}
</head>
<body>
  <h1>${novelName}</h1>
  
  <div class="toc">
    <h3>Table of Contents</h3>
    <ul>
      ${tableOfContents}
    </ul>
  </div>
  
  ${chapterContents}
</body>
</html>`;

        // Determine filename based on format - include timestamp to avoid conflicts
        let filename, fullPath;
        
        if (exportFormat === 'html') {
          filename = `${sanitizedNovelName}-combined-${timestamp}.html`;
          fullPath = `${novelDir}/${filename}`;
        } else { // EPUB
          filename = `${sanitizedNovelName}-combined-${timestamp}.epub`;
          fullPath = `${novelDir}/${filename}`;
        }
        
        // Check if file exists and handle it
        if (await FileManager.exists(fullPath)) {
          console.log(`EXPORT DEBUG - Combined file already exists, attempting to delete: ${fullPath}`);
          try {
            await FileManager.unlink(fullPath);
          } catch (error) {
            console.error(`EXPORT DEBUG - Could not delete existing file: ${error}`);
            // Generate new filename with different timestamp
            const uniqueTimestamp = Date.now().toString();
            const uniqueFilename = filename.replace(timestamp, uniqueTimestamp);
            fullPath = `${novelDir}/${uniqueFilename}`;
            console.log(`EXPORT DEBUG - Using alternative filename: ${uniqueFilename}`);
          }
        }
        
        try {
          // Write the file
          await FileManager.writeFile(fullPath, htmlContent);
          console.log(`EXPORT DEBUG - Combined export successful: ${filename}`);
          return true;
        } catch (error) {
          console.error('EXPORT DEBUG - Combined export error:', error);
          
          // Try with an even more unique filename
          const retryTimestamp = Date.now().toString() + Math.floor(Math.random() * 1000);
          const retryFilename = filename.replace(timestamp, retryTimestamp);
          const retryPath = `${novelDir}/${retryFilename}`;
          
          console.log(`EXPORT DEBUG - Retrying with different filename: ${retryPath}`);
          await FileManager.writeFile(retryPath, htmlContent);
          console.log(`EXPORT DEBUG - Export successful on retry: ${retryFilename}`);
          return true;
        }
      }
    } catch (error) {
      console.error('EXPORT DEBUG - Combined export error:', error);
      Alert.alert('Export Error', `Failed to export combined file: ${(error as Error).message || 'Unknown error'}`);
      return false;
    }
  }, [exportFormat, processHtmlContent]);

  // Helper function to show toast messages
  const showToast = (message: string) => {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  };

  // Helper function to get all selected chapters from the UI
  const getSelectedChapters = () => {
    const selectedChapters: any[] = [];
    
    // Debug information - dump selected keys
    console.log("===== DEBUG SELECTION =====");
    console.log("FULL SELECTION STATE:", JSON.stringify(selectedItems, null, 2));
    
    const selectedKeys = Object.keys(selectedItems).filter(key => selectedItems[parseInt(key)]);
    console.log("SELECTED KEYS:", selectedKeys);
    
    // Loop through all available chapters to check if they match selection
    console.log("CHECKING ALL AVAILABLE CHAPTERS FOR SELECTION MATCH");
    if (viewMode === 'flat') {
      console.log("FLAT VIEW MODE - Total translations:", translations.length);
      translations.forEach(t => {
        console.log(`Checking translation: id=${t.id}, chapterId=${t.chapterId}`);
        if ((t.id && selectedItems[t.id]) || 
            (t.chapterId && selectedItems[t.chapterId])) {
          console.log(`✅ MATCH! Adding chapter: id=${t.id}, chapterId=${t.chapterId}`);
          selectedChapters.push(t);
        }
      });
    } else {
      console.log("GROUPED VIEW MODE - Total novel groups:", groupedTranslations.length);
      // First get all novels
      const selectedNovelsArray = Object.keys(selectedNovels)
        .filter(key => selectedNovels[parseInt(key)])
        .map(key => parseInt(key));
      
      console.log("Selected novels:", selectedNovelsArray);
      
      // Process novels
      for (const novelId of selectedNovelsArray) {
        const novel = groupedTranslations.find(n => n.novelId === novelId);
        if (novel) {
          console.log(`Found novel ${novelId} with ${novel.chapters?.length || 0} chapters`);
          const novelChapters = novel.chapters || [];
          const chaptersToAdd = novelChapters.map((ch: any) => ({
            ...ch,
            novelId: novel.novelId,
            novelName: novel.novelTitle,
            pluginId: novel.pluginId
          }));
          
          console.log(`Adding ${chaptersToAdd.length} chapters from novel ${novelId}`);
          selectedChapters.push(...chaptersToAdd);
        }
      }
      
      // Then check individual chapters
      console.log("Checking for individually selected chapters...");
      for (const key of selectedKeys) {
        // Skip keys that belong to selected novels (already added)
        const keyNum = parseInt(key);
        if (selectedNovelsArray.includes(keyNum)) continue;
        
        console.log(`Checking selection key: ${key}`);
        
        // Find in all novels
        let found = false;
        for (const novel of groupedTranslations) {
          const chapters = novel.chapters || [];
          const matchingChapter = chapters.find((ch: any) => 
            (ch.id && ch.id === keyNum) || (ch.chapterId && ch.chapterId === keyNum)
          );
          
          if (matchingChapter && !found) {
            console.log(`✅ Found chapter ${key} in novel ${novel.novelId}`);
            
            // Check if already added via novel selection
            const alreadyAdded = selectedChapters.some(ch => 
              (ch.id && matchingChapter.id && ch.id === matchingChapter.id) || 
              (ch.chapterId && matchingChapter.chapterId && ch.chapterId === matchingChapter.chapterId)
            );
            
            if (!alreadyAdded) {
              console.log(`✅ Adding individual chapter ${key} from novel ${novel.novelId}`);
              selectedChapters.push({
                ...matchingChapter,
                novelId: novel.novelId,
                novelName: novel.novelTitle,
                pluginId: novel.pluginId
              });
              found = true;
            } else {
              console.log(`Chapter ${key} already added via novel selection`);
            }
          }
        }
        
        if (!found) {
          console.log(`⚠️ Could not find chapter with ID ${key} in any novel`);
        }
      }
    }
    
    console.log(`SELECTED ${selectedChapters.length} CHAPTERS TOTAL`);
    
    // Remove duplicates  
    const uniqueChapters = Array.from(
      new Map(
        selectedChapters.map(item => [
          item.id || item.chapterId, 
          item
        ])
      ).values()
    );
    
    console.log(`After deduplication: ${uniqueChapters.length} unique chapters`);
    uniqueChapters.forEach((ch, i) => {
      console.log(`Selected chapter ${i+1}: id=${ch.id}, chapterId=${ch.chapterId}, novelId=${ch.novelId}`);
    });
    
    const normalizedChapters = uniqueChapters.map(item => {
      return {
        ...item,
        id: item.id || item.chapterId,
        chapterId: item.chapterId || item.id,
        novelId: item.novelId
      };
    });
    
    console.log(`Final normalized chapters count: ${normalizedChapters.length}`);
    console.log("===== END DEBUG SELECTION =====");
    
    return normalizedChapters;
  };

  // Single export handler - modified to handle the export format
  const handleExportTranslation = useCallback(async (translation: any) => {
    let success;
    const novelName = translation.novelName || translation.novelTitle || 'Unknown Novel';
    
    if (exportMode === 'multiple' || !translation.novelId) {
      // Export as individual file
      success = await exportTranslation(translation);
      
      if (success) {
        ToastAndroid.show(
          `Translation exported to Downloads/LNReader/${novelName} as ${exportFormat === 'txt' ? 'TXT' : 'HTML'}`, 
          ToastAndroid.LONG
        );
      } else {
        ToastAndroid.show('Failed to export translation', ToastAndroid.LONG);
      }
    } else {
      // Find the novel and all its chapters for combined export
      const novel = groupedTranslations.find(n => n.novelId === translation.novelId);
      if (novel && novel.chapters && novel.chapters.length > 0) {
        success = await exportCombinedFile(novel, novel.chapters);
        
        if (success) {
          ToastAndroid.show(
            `All chapters exported to Downloads/LNReader/${novelName} as combined ${exportFormat === 'txt' ? 'TXT' : 'HTML'}`, 
            ToastAndroid.LONG
          );
        } else {
          ToastAndroid.show('Failed to export combined file', ToastAndroid.LONG);
        }
      } else {
        // If we can't find the novel and chapters, fall back to single export
        success = await exportTranslation(translation);
        
        if (success) {
          ToastAndroid.show(
            `Translation exported to Downloads/LNReader/${novelName} as ${exportFormat === 'txt' ? 'TXT' : 'HTML'}`, 
            ToastAndroid.LONG
          );
        } else {
          ToastAndroid.show('Failed to export translation', ToastAndroid.LONG);
        }
      }
    }
  }, [exportTranslation, exportCombinedFile, exportFormat, exportMode, groupedTranslations]);

  // Utility functions for UI interaction
  const toggleViewMode = useCallback(() => {
    setViewMode(prev => prev === 'flat' ? 'grouped' : 'flat');
  }, []);

  const toggleSelectionMode = useCallback(() => {
    const wasSelectionMode = selectionMode;
    setSelectionMode(prev => !prev);
    
    // Clear selections when turning off selection mode
    if (wasSelectionMode) {
      console.log('[SELECTION] Exiting selection mode, clearing selections');
      setSelectedItems({});
      setSelectedNovels({});
    } else {
      console.log('[SELECTION] Entering selection mode');
    }
  }, [selectionMode]);

  const toggleSelection = useCallback((id: number, chapterId?: number) => {
    console.log(`🔥 [TOGGLE] Toggling selection for id=${id}, chapterId=${chapterId}`);
    
    // Log selection state before change
    const keysBefore = Object.keys(selectedItems)
      .filter(k => selectedItems[parseInt(k)])
      .map(k => parseInt(k));
    console.log(`🔥 [TOGGLE] Current selected keys (${keysBefore.length}):`, keysBefore);
    
    setSelectedItems(prev => {
      const newSelection = { ...prev };
      
      // Use both id and chapterId to ensure selection works with either
      // First mark the primary ID
      if (id) {
        newSelection[id] = !prev[id];
        console.log(`🔥 [TOGGLE] Setting selection for id=${id} to ${!prev[id]}`);
      }
      
      // If chapterId is provided and different from id, also mark it
      if (chapterId && chapterId !== id) {
        newSelection[chapterId] = !prev[chapterId];
        console.log(`🔥 [TOGGLE] Setting selection for chapterId=${chapterId} to ${!prev[chapterId]}`);
      }
      
      // For maximum compatibility, also mark all possible ID combinations
      if (id && chapterId && id !== chapterId) {
        // Ensure both IDs have the same selection state
        newSelection[id] = !prev[id];
        newSelection[chapterId] = !prev[id]; // Use the same value as id
        console.log(`🔥 [TOGGLE] Synchronizing selection states for both IDs`);
      }
      
      // Debug log the new state
      const selectedCount = Object.keys(newSelection).filter(k => newSelection[parseInt(k)]).length;
      console.log(`🔥 [TOGGLE] New selection state has ${selectedCount} items selected`);
      
      return newSelection;
    });
  }, []);

  // When a row is rendered and selection changes, make this more visible for debugging
  useEffect(() => {
    const selectedCount = Object.keys(selectedItems).filter(key => selectedItems[parseInt(key)]).length;
    const novelCount = Object.keys(selectedNovels).filter(key => selectedNovels[parseInt(key)]).length;
    
    console.log(`[UI STATE] Selection changed - Items: ${selectedCount}, Novels: ${novelCount}`);
    
    if (selectedCount > 0 || novelCount > 0) {
      // Log the actual IDs that are selected
      const selectedIds = Object.entries(selectedItems)
        .filter(([_, selected]) => selected)
        .map(([id, _]) => id);
      
      console.log('[UI STATE] Selected IDs:', selectedIds);
    }
  }, [selectedItems, selectedNovels]);

  const toggleNovelExpand = useCallback((novelId: number) => {
    setExpandedItems(prev => ({
      ...prev,
      [novelId]: !prev[novelId]
    }));
  }, []);

  const toggleNovelSelection = useCallback((novelId: number, chapters: any[]) => {
    const isSelected = selectedNovels[novelId] !== true;
    
    console.log(`[NOVEL SELECTION] Toggling novel ${novelId} to ${isSelected}, with ${chapters.length} chapters`);
    
    // Update the novel selection state
    setSelectedNovels(prev => ({
      ...prev,
      [novelId]: isSelected
    }));
    
    // Update the selected items based on the novel selection
    setSelectedItems(prev => {
      const newSelection = {...prev};
      
      // For all chapters in this novel, set them to the same selection state
      if (chapters && chapters.length > 0) {
        chapters.forEach(chapter => {
          // Make sure we mark BOTH id and chapterId for maximum compatibility
          if (chapter) {
            if (chapter.id) {
              newSelection[chapter.id] = isSelected;
              console.log(`[NOVEL SELECTION] Setting chapter id=${chapter.id} to ${isSelected}`);
            }
            
            if (chapter.chapterId && chapter.chapterId !== chapter.id) {
              newSelection[chapter.chapterId] = isSelected;
              console.log(`[NOVEL SELECTION] Setting chapter chapterId=${chapter.chapterId} to ${isSelected}`);
            }
          }
        });
        
        console.log(`[NOVEL SELECTION] Updated ${chapters.length} chapters' selection state`);
      } else {
        console.log(`[NOVEL SELECTION] Warning: No chapters found for novel ${novelId}`);
      }
      
      return newSelection;
    });
  }, [selectedNovels]);

  // Calculate the total number of selected items
  const getTotalSelectedItems = useCallback(() => {
    // Count individually selected items
    const individuallySelectedCount = Object.values(selectedItems).filter(Boolean).length;
    
    // Count items that are selected via novel selection but not counted individually
    let novelSelectionCount = 0;
    
    if (Object.values(selectedNovels).some(Boolean)) {
      for (const [novelIdStr, isSelected] of Object.entries(selectedNovels)) {
        if (isSelected) {
          const novelId = parseInt(novelIdStr, 10);
          const novel = groupedTranslations.find(n => n.novelId === novelId);
          if (novel && novel.chapters) {
            novel.chapters.forEach((chapter: any) => {
              if (chapter.chapterId && !selectedItems[chapter.chapterId]) {
                novelSelectionCount++;
              }
            });
          }
        }
      }
    }
    
    return individuallySelectedCount + novelSelectionCount;
  }, [selectedItems, selectedNovels, groupedTranslations]);

  // Handler for batch translation
  const handleBatchTranslate = useCallback(async () => {
    try {
      // CRITICAL: Directly capture UI state for selection
      console.log("🔥 [BATCH START] Beginning batch translate operation");
      console.log(`🔥 [BATCH START] Selected items state:`, 
        Object.keys(selectedItems)
          .filter(key => selectedItems[parseInt(key)])
          .map(key => parseInt(key))
      );
      
      // CRITICAL: Ensure we get all selected chapters
      const selectedChapters = getSelectedChapters();
      
      console.log(`🔥 [BATCH TRACE] Initial selected chapters count: ${selectedChapters.length}`);
      
      if (selectedChapters.length === 0) {
        ToastAndroid.show("No chapters selected for translation.", ToastAndroid.SHORT);
        return;
      }
      
      // CRITICAL: Use direct access to selectedItems to build chapters list
      // This bypasses any potential logic issues in getSelectedChapters
      console.log("🔥 [BATCH DIRECT] Building chapters list directly from selection state");
      
      const directSelectedKeys = Object.keys(selectedItems)
        .filter(key => selectedItems[parseInt(key)])
        .map(key => parseInt(key));
      
      console.log(`🔥 [BATCH DIRECT] Found ${directSelectedKeys.length} directly selected keys:`, directSelectedKeys);
      
      const directSelectedChapters: any[] = [];
      
      // Find chapters that match these IDs from all possible sources
      for (const key of directSelectedKeys) {
        console.log(`🔥 [BATCH DIRECT] Finding chapter for key ${key}`);
        
        // Try to find in translations list first (flat view)
        let found = false;
        for (const t of translations) {
          if (t.id === key || t.chapterId === key) {
            console.log(`🔥 [BATCH DIRECT] Found in translations list: id=${t.id}, chapterId=${t.chapterId}`);
            directSelectedChapters.push({
              ...t,
              id: t.id || t.chapterId,
              chapterId: t.chapterId || t.id
            });
            found = true;
            break;
          }
        }
        
        // If not found, try in grouped view
        if (!found) {
          for (const novel of groupedTranslations) {
            const chapters = novel.chapters || [];
            for (const ch of chapters) {
              if (ch.id === key || ch.chapterId === key) {
                console.log(`🔥 [BATCH DIRECT] Found in grouped view: id=${ch.id}, chapterId=${ch.chapterId}, novel=${novel.novelId}`);
                directSelectedChapters.push({
                  ...ch,
                  id: ch.id || ch.chapterId,
                  chapterId: ch.chapterId || ch.id,
                  novelId: novel.novelId,
                  novelName: novel.novelTitle,
                  pluginId: novel.pluginId
                });
                found = true;
                break;
              }
            }
            if (found) break;
          }
        }
        
        if (!found) {
          console.log(`🔥 [BATCH DIRECT] Could not find chapter for key ${key}`);
        }
      }
      
      console.log(`🔥 [BATCH DIRECT] Found ${directSelectedChapters.length} chapters by direct selection`);
      
      // Use direct selected chapters if we found any, otherwise use the original selection method
      const chaptersToProcess = 
        directSelectedChapters.length > 0 ? directSelectedChapters : [...selectedChapters];
      
      console.log(`🔥 [BATCH TRACE] Final chapters to process: ${chaptersToProcess.length}`);
      chaptersToProcess.forEach((ch, idx) => {
        console.log(`🔥 [BATCH TRACE] Chapter ${idx+1}: id=${ch.id}, chapterId=${ch.chapterId}, novelId=${ch.novelId}`);
      });
      
      // Group chapters by novel for efficient processing
      const novelGroups: Record<string, { novel: any, chapters: any[] }> = {};
      
      // Group all selected chapters by novel
      chaptersToProcess.forEach(chapter => {
        const novelId = chapter.novelId?.toString() || 'unknown';
        
        if (!novelGroups[novelId]) {
          novelGroups[novelId] = {
            novel: {
              id: chapter.novelId,
              name: chapter.novelName || chapter.novelTitle || 'Unknown',
              pluginId: chapter.pluginId || 'unknown' // Ensure pluginId is set
            },
            chapters: []
          };
        }
        
        // Add this chapter to the appropriate novel group
        novelGroups[novelId].chapters.push(chapter);
      });
      
      console.log(`🔥 [BATCH TRACE] Grouped into ${Object.keys(novelGroups).length} novels`);
      
      // Process each novel group separately
      let totalTranslated = 0;
      
      for (const novelId in novelGroups) {
        const { novel, chapters } = novelGroups[novelId];
        
        console.log(`🔥 [BATCH TRACE] Novel ${novelId}: Processing ${chapters.length} chapters`);
        console.log(`🔥 [BATCH TRACE] Novel details: name=${novel.name}, pluginId=${novel.pluginId}`);
        
        // Log each chapter
        chapters.forEach((ch, idx) => {
          console.log(`🔥 [BATCH TRACE] Chapter ${idx+1}: id=${ch.id}, chapterId=${ch.chapterId}`);
        });
        
        // Check API key from component level variables instead of hook
        if (!apiKey) {
          showToast('Please enter an OpenRouter API key in settings');
          continue; // Skip this novel but try others
        }
        
        // Directly pass chapters to BatchTranslationService
        console.log(`🔥 [BATCH TRACE] Calling batchTranslateChapters with ${chapters.length} chapters`);
        
        try {
          const translatedCount = await batchTranslateChapters(
            chapters,
            novel,
            apiKey,
            model || 'openai/gpt-3.5-turbo',
            defaultInstruction || ''
          );
          
          console.log(`🔥 [BATCH TRACE] Novel ${novelId}: Translated ${translatedCount} chapters`);
          totalTranslated += translatedCount;
        } catch (error) {
          console.error(`🔥 [BATCH TRACE] Error processing novel ${novelId}:`, error);
        }
      }
      
      // After all translations complete
      setSelectionMode(false);
      setSelectedItems({});
      setSelectedNovels({});
      loadTranslations(); // Reload to reflect changes
      
      if (totalTranslated > 0) {
        ToastAndroid.show(`Successfully translated ${totalTranslated} chapter(s)`, ToastAndroid.SHORT);
      } else {
        ToastAndroid.show(`No chapters were translated`, ToastAndroid.SHORT);
      }
    } catch (error) {
      console.error("🔥 [BATCH TRACE] Batch translation failed:", error);
      ToastAndroid.show("Translation failed. Please check logs.", ToastAndroid.LONG);
    }
  }, [getSelectedChapters, batchTranslateChapters, showToast, loadTranslations, selectedItems, translations, groupedTranslations, apiKey, model, defaultInstruction]);

  // Handler for batch deletion
  const handleBatchDelete = useCallback(() => {
    const selectedChapters = getSelectedChapters();
    
    console.log(`[BATCH DELETE] Selected ${selectedChapters.length} chapters for deletion`);
    
    if (selectedChapters.length === 0) {
      ToastAndroid.show("No items selected for deletion.", ToastAndroid.SHORT);
      return;
    }
    
    Alert.alert(
      "Confirm Deletion",
      `Are you sure you want to delete ${selectedChapters.length} translations?`,
      [
        {
          text: "Cancel",
          style: "cancel"
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              // Delete translations one by one
              let deletedCount = 0;
              for (const chapter of selectedChapters) {
                const chapterId = chapter.chapterId || chapter.id;
                if (chapterId) {
                  await deleteTranslation(chapterId);
                  deletedCount++;
                  console.log(`[BATCH DELETE] Deleted translation for chapter ${chapterId}`);
                }
              }
              
              ToastAndroid.show(`Deleted ${deletedCount} translations`, ToastAndroid.SHORT);
              
              // Clear selection and reload
              setSelectionMode(false);
              setSelectedItems({});
              setSelectedNovels({});
              loadTranslations();
            } catch (error) {
              console.error("[BATCH DELETE] Batch deletion error:", error);
              Alert.alert("Error", "Failed to delete some translations. Please try again.");
            }
          }
        }
      ]
    );
  }, [getSelectedChapters, loadTranslations]);

  // Handler for select all
  const handleSelectAll = useCallback(() => {
    if (viewMode === 'flat') {
      // Select all chapters in flat view
      const allSelectedItems: { [key: number]: boolean } = {};
      translations.forEach(translation => {
        allSelectedItems[translation.chapterId] = true;
      });
      setSelectedItems(allSelectedItems);
    } else {
      // Select all novels in grouped view
      const allSelectedNovels: { [key: number]: boolean } = {};
      groupedTranslations.forEach(novel => {
        allSelectedNovels[novel.novelId] = true;
      });
      setSelectedNovels(allSelectedNovels);
    }
    
    ToastAndroid.show("All items selected", ToastAndroid.SHORT);
  }, [viewMode, translations, groupedTranslations]);

  // Handler for batch export
  const handleBatchExport = useCallback(async () => {
    const selectedChapters = getSelectedChapters();
    
    if (selectedChapters.length === 0) {
      ToastAndroid.show("No items selected for export.", ToastAndroid.SHORT);
      return;
    }

    // Set up export options dialog
    Alert.alert(
      "Export Options",
      "Select format for exporting translations",
      [
        {
          text: "Cancel",
          style: "cancel"
        },
        {
          text: `Export as ${exportFormat.toUpperCase()} (${exportMode === 'multiple' ? 'Per Chapter' : 'Per Novel'})`,
          onPress: async () => {
            try {
              // Group chapters by novel for organized export
              const novelMap: Record<string, { novel: any, chapters: any[] }> = {};
              
              // Group chapters by novelId
              selectedChapters.forEach(chapter => {
                const novelId = chapter.novelId?.toString() || 'unknown';
                const novelTitle = chapter.novelName || chapter.novelTitle || 'Unknown Novel';
                
                if (!novelMap[novelId]) {
                  novelMap[novelId] = {
                    novel: {
                      novelId: chapter.novelId,
                      novelTitle: novelTitle,
                      novelCover: chapter.novelCover
                    },
                    chapters: []
                  };
                }
                novelMap[novelId].chapters.push(chapter);
              });
              
              // Export mode handling
              if (exportMode === 'multiple') {
                // Export each chapter individually
                for (const novelId in novelMap) {
                  const { chapters } = novelMap[novelId];
                  for (const chapter of chapters) {
                    await exportTranslation(chapter);
                  }
                }
                
                ToastAndroid.show(
                  `Exported ${selectedChapters.length} chapters as individual files`, 
                  ToastAndroid.LONG
                );
              } else {
                // Export each novel as a single combined file
                let exportedNovels = 0;
                
                for (const novelId in novelMap) {
                  const { novel, chapters } = novelMap[novelId];
                  if (chapters.length > 0) {
                    await exportCombinedFile(novel, chapters);
                    exportedNovels++;
                  }
                }
                
                ToastAndroid.show(
                  `Exported ${exportedNovels} novels as combined files`, 
                  ToastAndroid.LONG
                );
              }
              
              // Clear selection
              setSelectionMode(false);
              setSelectedItems({});
              setSelectedNovels({});
            } catch (error) {
              console.error("Batch export error:", error);
              Alert.alert("Error", "Failed to export some translations. Please try again.");
            }
          }
        }
      ]
    );
  }, [getSelectedChapters, exportFormat, exportMode, exportTranslation, exportCombinedFile]);

  const onStateChange = ({ open }: { open: boolean }) => setOpenFab(open);

  const renderFlatItem = ({ item }: { item: any }) => {
    // Skip null or undefined items
    if (!item) return null;
    
    const novelName = item.novelName || "Unknown Novel";
    const chapterName = item.chapterName || "Unknown Chapter";
    const previewText = item.previewText || "";
    const model = item.model || "unknown";
    const createdAt = item.createdAt ? new Date(item.createdAt) : new Date();
    const itemId = item.id;
    const chapterId = item.chapterId;
    // Check both id and chapterId for selection status
    const itemSelected = (itemId && selectedItems[itemId]) || (chapterId && selectedItems[chapterId]);
    
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleContainer}>
              <Text variant="titleMedium" style={styles.novelTitle}>{novelName}</Text>
              <Text variant="bodyMedium">{chapterName}</Text>
            </View>
            
            {selectionMode && (
              <Checkbox
                status={itemSelected ? 'checked' : 'unchecked'}
                onPress={() => toggleSelection(itemId, chapterId)}
              />
            )}
          </View>
          
          <Divider style={styles.divider} />
          
          <View style={styles.previewContainer}>
            <Text variant="bodySmall" numberOfLines={2} style={styles.preview}>{previewText}</Text>
          </View>
          
          <View style={styles.metaRow}>
            <Chip icon="translate" style={styles.chip}>{model}</Chip>
            <Text variant="bodySmall">{formatDate(createdAt)}</Text>
          </View>
        </Card.Content>
        
        {!selectionMode && (
          <Card.Actions>
            <Button 
              mode="text" 
              onPress={() => handleExportTranslation(item)} 
              icon="export"
              compact
            >
              Export
            </Button>
            <Button 
              mode="text" 
              onPress={() => chapterId && confirmDeleteTranslation(chapterId)} 
              icon="delete" 
              textColor="red"
              compact
            >
              Delete
            </Button>
          </Card.Actions>
        )}
      </Card>
    );
  };

  const renderGroupedItem = ({ item, section }: { item: any, section: any }) => {
    // Skip null or undefined items
    if (!item) return null;
    
    const chapterTitle = item.chapterTitle || "Unknown Chapter";
    const previewText = item.previewText || "";
    const itemId = item.id;
    const chapterId = item.chapterId;
    
    // Ensure we have a valid ID for selection
    const effectiveId = itemId || chapterId;
    if (!effectiveId) {
      console.warn(`[UI RENDER] Chapter has no ID: ${chapterTitle}`);
    }
    
    // Check both id and chapterId for selection status
    const itemSelected = (itemId && selectedItems[itemId]) || (chapterId && selectedItems[chapterId]);
    
    // For debugging
    if (itemSelected) {
      console.log(`[UI RENDER] Rendering selected chapter: ID=${itemId}, ChapterID=${chapterId}, Title=${chapterTitle}`);
    }
    
    return (
      <List.Item
        title={chapterTitle}
        description={
          <View>
            <Text numberOfLines={1}>{previewText}</Text>
            <Text style={styles.debugInfo}>ID: {itemId}, ChapterID: {chapterId}</Text>
          </View>
        }
        onPress={() => {
          if (selectionMode) {
            console.log(`[UI ACTION] Selection toggle from item press: ${itemId || chapterId}`);
            toggleSelection(itemId || chapterId, chapterId);
          }
        }}
        right={props => !selectionMode ? (
          <View style={styles.actionButtons}>
            <IconButton 
              {...props} 
              icon="export" 
              size={20}
              onPress={() => handleExportTranslation({
                ...item,
                novelName: section?.novelTitle || "Unknown Novel",
                chapterName: chapterTitle,
              })} 
            />
            <IconButton 
              {...props} 
              icon="delete" 
              size={20}
              iconColor="red"
              onPress={() => chapterId && confirmDeleteTranslation(chapterId)} 
            />
          </View>
        ) : (
          <Checkbox
            status={itemSelected ? 'checked' : 'unchecked'}
            onPress={() => {
              console.log(`[UI ACTION] Selection toggle from checkbox: ${itemId || chapterId}`);
              toggleSelection(itemId || chapterId, chapterId);
            }}
          />
        )}
        style={[
          selectionMode ? { paddingLeft: 0 } : undefined,
          itemSelected ? styles.selectedItem : undefined
        ]}
      />
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.buttonRow}>
        <Button 
          mode="outlined" 
          icon={selectionMode ? "check-circle" : "checkbox-marked-circle-outline"} 
          onPress={toggleSelectionMode}
          style={styles.button}
        >
          {selectionMode 
            ? `${getTotalSelectedItems()} selected`
            : "Edit"}
        </Button>
        
        <Button 
          mode="outlined" 
          icon={viewMode === 'flat' ? "view-list" : "view-grid"} 
          onPress={toggleViewMode}
          style={styles.button}
        >
          {viewMode === 'flat' 
            ? "Group by Novel" 
            : "Flat List"}
        </Button>
      </View>
      
      {/* Export options */}
      <View style={styles.exportOptionsContainer}>
        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>Format:</Text>
          <SegmentedButtons
            value={exportFormat}
            onValueChange={value => setExportFormat(value as ExportFormat)}
            buttons={[
              { value: 'txt', label: 'TXT' },
              { value: 'html', label: 'HTML' },
              { value: 'epub', label: 'EPUB' }
            ]}
            style={styles.segmentedButton}
          />
        </View>
        
        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>Export Mode:</Text>
          <SegmentedButtons
            value={exportMode}
            onValueChange={value => setExportMode(value as ExportMode)}
            buttons={[
              { value: 'multiple', label: 'Multiple Files' },
              { value: 'single', label: 'Single File' }
            ]}
            style={styles.segmentedButton}
          />
        </View>
      </View>
      
      {/* Info text about export location */}
      <View style={styles.infoContainer}>
        <Text style={styles.infoText}>
          {exportMode === 'multiple' 
            ? `Exports are saved to: Download/LNReader/[Novel Name]/[Chapter].${exportFormat === 'txt' ? 'TXT' : exportFormat === 'html' ? 'HTML' : 'EPUB'}`
            : `Exports are saved to: Download/LNReader/[Novel Name]/[Novel]-combined.${exportFormat === 'txt' ? 'TXT' : exportFormat === 'html' ? 'HTML' : 'EPUB'}`}
        </Text>
      </View>
      
      <Divider style={styles.divider} />
    </View>
  );

  const renderSectionHeader = ({ section }: { section: any }) => {
    if (!section) return null;
    
    const chapters = section.chapters || [];
    const chapterCount = Array.isArray(chapters) ? chapters.length : 0;
    const isExpanded = expandedItems[section.novelId] === true;
    const novelIsSelected = selectedNovels[section.novelId] === true;
    const novelTitle = section.novelTitle || "Unknown Novel";
    
    // Log expanded section contents for debugging
    if (isExpanded) {
      console.log(`[UI RENDER] Section expanded: ${novelTitle} with ${chapterCount} chapters`);
      if (chapterCount > 0) {
        console.log(`[UI RENDER] First few chapters: `, 
          chapters.slice(0, Math.min(3, chapterCount)).map((ch: any) => ({
            id: ch.id,
            chapterId: ch.chapterId,
            title: ch.chapterTitle
          }))
        );
      }
    }
    
    return (
      <View style={styles.sectionContainer}>
        <View style={styles.headerRow}>
          {selectionMode && (
            <TouchableOpacity 
              style={styles.checkboxContainer}
              onPress={() => {
                console.log(`[UI ACTION] Toggle novel selection: ${section.novelId}, chapters: ${chapterCount}`);
                toggleNovelSelection(section.novelId, chapters);
              }}
            >
              <Checkbox
                status={novelIsSelected ? 'checked' : 'unchecked'}
                onPress={undefined}
              />
            </TouchableOpacity>
          )}
          
          {/* Manual accordion implementation */}
          <TouchableOpacity 
            style={styles.accordionHeader}
            onPress={() => {
              console.log(`[UI ACTION] Toggle expand novel: ${section.novelId}`);
              toggleNovelExpand(section.novelId);
            }}
          >
            <View style={styles.accordionContent}>
              <Text style={styles.accordionTitle}>
                {novelTitle}
              </Text>
              <Text style={styles.accordionDescription}>
                {`${chapterCount} chapters`}
              </Text>
            </View>
            
            <IconButton
              icon={isExpanded ? "chevron-up" : "chevron-down"}
              size={24}
            />
          </TouchableOpacity>
        </View>
        
        {/* Only render items when expanded */}
        {isExpanded && chapters.map((item: any) => {
          // Ensure each chapter has both id and chapterId set properly
          const completeItem = {
            ...item,
            id: item.id || item.chapterId,
            chapterId: item.chapterId || item.id
          };
          return (
            <View key={completeItem.id} style={selectionMode ? styles.indentedItem : undefined}>
              {renderGroupedItem({ item: completeItem, section })}
            </View>
          );
        })}
      </View>
    );
  };

  const renderEmptyComponent = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>No translations found</Text>
    </View>
  );

  const renderSectionList = () => {
    if (!groupedTranslations || groupedTranslations.length === 0) {
      if (translations && translations.length > 0) {
        return (
          <View style={styles.emptyContainer}>
            <ActivityIndicator size="small" />
            <Text style={styles.emptyText}>Loading group view...</Text>
          </View>
        );
      }
      return renderEmptyComponent();
    }

    // Use FlatList for sections instead of SectionList
    return (
      <FlatList
        data={groupedTranslations}
        renderItem={({ item }) => renderSectionHeader({ section: item })}
        keyExtractor={item => (item && item.novelId ? item.novelId.toString() : 'unknown')}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyComponent}
      />
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" style={styles.loader} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderHeader()}
      
      {viewMode === 'flat' ? (
        <FlatList
          data={translations || []}
          renderItem={renderFlatItem}
          keyExtractor={item => (item && item.id ? item.id.toString() : 'unknown')}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmptyComponent}
        />
      ) : renderSectionList()}

      <Portal>
        <FAB.Group
          open={openFab}
          visible={true}
          icon={openFab ? 'close' : selectionMode ? 'dots-vertical' : 'plus'}
          actions={
             selectionMode ? 
               (hasSelectedItems ? 
                [
                  {
                    icon: 'trash-can-outline',
                    label: 'Delete Selected',
                    onPress: handleBatchDelete,
                    testID: 'delete-selected',
                  },
                  {
                    icon: 'export',
                    label: 'Export Selected',
                    onPress: handleBatchExport,
                    testID: 'export-selected',
                  },
                  {
                    icon: 'select-all',
                    label: 'Select All',
                    onPress: handleSelectAll,
                    testID: 'select-all',
                  },
                ]
                : 
                [
                  {
                    icon: 'select-all',
                    label: 'Select All',
                    onPress: handleSelectAll,
                    testID: 'select-all',
                  },
                  {
                    icon: 'delete-sweep',
                    label: 'Delete All Translations',
                    onPress: confirmDeleteAllTranslations,
                    testID: 'delete-all',
                  },
                ]
               )
             : 
             [
               {
                 icon: 'delete-sweep',
                 label: 'Delete All Translations',
                 onPress: confirmDeleteAllTranslations,
                 testID: 'delete-all',
               },
             ]
          }
          onStateChange={onStateChange}
          onPress={() => {
            if (openFab) {
              // If the FAB group is open, the press closes it via onStateChange
            } else if (selectionMode) {
              // Always open the FAB menu in selection mode
              setOpenFab(true);
            } else {
              // If not in selection mode, toggle selection mode when FAB is pressed
              toggleSelectionMode();
            }
          }}
        />
      </Portal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  button: {
    flex: 1,
    marginHorizontal: 4,
  },
  infoContainer: {
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 4,
    marginVertical: 8,
  },
  infoText: {
    textAlign: 'center',
  },
  divider: {
    marginVertical: 8,
  },
  listContent: {
    padding: 16,
    paddingBottom: 80, // Space for FAB
  },
  card: {
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitleContainer: {
    flex: 1,
    marginRight: 8,
  },
  novelTitle: {
    fontWeight: 'bold',
  },
  previewContainer: {
    marginVertical: 4,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  preview: {
    fontStyle: 'italic',
  },
  chip: {
    height: 26,
  },
  sectionContainer: {
    marginVertical: 4,
    backgroundColor: 'white',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)'
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center', 
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingLeft: 16,
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.02)'
  },
  accordionContent: {
    flex: 1
  },
  accordionTitle: {
    fontSize: 16,
    fontWeight: 'bold'
  },
  accordionDescription: {
    fontSize: 14,
    opacity: 0.7
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    opacity: 0.6,
  },
  loader: {
    flex: 1,
  },
  actionButtons: {
    flexDirection: 'row',
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: 'white'
  },
  indentedItem: {
    marginLeft: 40 // Indentation to align with the accordion content
  },
  checkboxContainer: {
    padding: 10,
    marginLeft: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10 // Ensure the checkbox is above other elements
  },
  exportOptionsContainer: {
    marginVertical: 8,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.02)',
    borderRadius: 4,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  optionLabel: {
    marginRight: 8,
    width: 100,
  },
  segmentedButton: {
    flex: 1,
  },
  selectedItem: {
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  debugInfo: {
    fontSize: 12,
    opacity: 0.7,
  },
});

export default TranslationListScreen;