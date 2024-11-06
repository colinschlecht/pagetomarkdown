console.log('Content script loaded');

// Make sure Readability is available
if (typeof Readability === 'undefined') {
    console.error('Readability is not defined!');
}

// Make sure Turndown is available
if (typeof TurndownService === 'undefined') {
    console.error('TurndownService is not defined!');
}

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});

// Add custom rules for better Markdown conversion
turndownService.addRule('figures', {
    filter: 'figure',
    replacement: function(content, node) {
        console.log('Processing figure:', node);
        const img = node.querySelector('img');
        const caption = node.querySelector('figcaption');
        if (img) {
            const alt = img.getAttribute('alt') || '';
            const src = img.getAttribute('src') || '';
            const captionText = caption ? caption.textContent : '';
            console.log('Figure processed:', { alt, src, captionText });
            return `![${alt}](${src})\n${captionText}\n\n`;
        }
        return content;
    }
});

// Store the clean metadata in a closure to prevent it from being affected by DOM cleanup
let preservedMetadata = null;

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Message received in content script:', message);
    if (message.action === "convert") {
        convertPageToMarkdown()
        .then(markdownData => {
            console.log('Conversion successful:', markdownData);
            sendResponse({
                success: true,
                markdownContent: markdownData.content,
                fileName: markdownData.fileName
            });
        })
        .catch((error) => {
            console.error('Error in convertPageToMarkdown:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
});

async function convertPageToMarkdown() {
    console.log('Starting conversion...');
    try {
        // First pass just for metadata extraction from pristine HTML
        const metadataClone = document.implementation.createHTMLDocument();
        const metadataDoc = document.documentElement.cloneNode(true);
        metadataClone.documentElement.replaceWith(metadataDoc);

        console.log('Creating Readability instance for metadata extraction...');
        const metadataReader = new Readability(metadataClone, {
            debug: true,
            charThreshold: 20
        });

        const metadataArticle = metadataReader.parse();

        // Store the clean metadata immediately after extraction
        preservedMetadata = {
            // Readability extracted
            title: metadataArticle?.title,
            byline: metadataArticle?.byline,
            siteName: metadataArticle?.siteName,
            excerpt: metadataArticle?.excerpt,

            // OpenGraph
            ogTitle: metadataDoc.querySelector('meta[property="og:title"]')?.content,
            ogDescription: metadataDoc.querySelector('meta[property="og:description"]')?.content,
            ogSiteName: metadataDoc.querySelector('meta[property="og:site_name"]')?.content,
            ogType: metadataDoc.querySelector('meta[property="og:type"]')?.content,
            ogImage: metadataDoc.querySelector('meta[property="og:image"]')?.content,

            // Twitter Cards
            twitterTitle: metadataDoc.querySelector('meta[name="twitter:title"]')?.content,
            twitterDescription: metadataDoc.querySelector('meta[name="twitter:description"]')?.content,
            twitterCreator: metadataDoc.querySelector('meta[name="twitter:creator"]')?.content,

            // Schema.org JSON-LD
            jsonLd: (() => {
                try {
                    const scripts = metadataDoc.querySelectorAll('script[type="application/ld+json"]');
                    return Array.from(scripts).map(script => JSON.parse(script.textContent));
                } catch (e) {
                    console.error('Error parsing JSON-LD:', e);
                    return [];
                }
            })(),

            // Dublin Core
            dcTitle: metadataDoc.querySelector('meta[name="DC.title"]')?.content,
            dcCreator: metadataDoc.querySelector('meta[name="DC.creator"]')?.content,
            dcDescription: metadataDoc.querySelector('meta[name="DC.description"]')?.content,
            dcDate: metadataDoc.querySelector('meta[name="DC.date"]')?.content,

            // Standard HTML metadata
            metaDescription: metadataDoc.querySelector('meta[name="description"]')?.content,
            metaAuthor: metadataDoc.querySelector('meta[name="author"]')?.content,
            metaKeywords: metadataDoc.querySelector('meta[name="keywords"]')?.content,
            canonicalUrl: metadataDoc.querySelector('link[rel="canonical"]')?.href,

            // Publication date
            publishDate: metadataDoc.querySelector('meta[property="article:published_time"]')?.content ||
            metadataDoc.querySelector('time[pubdate]')?.getAttribute('datetime') ||
            metadataDoc.querySelector('[class*="publish"],[class*="date"]')?.textContent
        };

        console.log('Extracted metadata:', preservedMetadata);

        // Second clone for content
        const documentClone = document.implementation.createHTMLDocument();
        const doc = document.documentElement.cloneNode(true);
        documentClone.documentElement.replaceWith(doc);

        console.log('Creating Readability instance for content...');
        const reader = new Readability(documentClone, {
            debug: true,
            charThreshold: 20,
            keepClasses: false,
            cleanConditionally: true,
            removeEmpty: true
        });

        const article = reader.parse();
        console.log('Content parsing complete');

        if (!article) {
            throw new Error('Could not parse page content');
        }

        // Create a temporary container for the parsed content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = article.content;

        // Post-Readability cleanup
        const postCleanup = (element) => {
            // Remove empty elements
            element.querySelectorAll('*').forEach(el => {
                if (el.innerHTML.trim() === '') {
                    console.log('Removing empty element post-parse:', el.outerHTML);
                    el.remove();
                }
            });

            // Remove any remaining unwanted elements that Readability might have missed
            const unwantedSelectors = [
                'script', 'style', 'iframe',
                '[class*="advertisement"]',
                '[class*="social-share"]',
                '[class*="related-articles"]',
                '[class*="newsletter"]',
                '[role="complementary"]'
            ];

            unwantedSelectors.forEach(selector => {
                element.querySelectorAll(selector).forEach(el => {
                    console.log('Removing unwanted element post-parse:', el.outerHTML.substring(0, 100));
                    el.remove();
                });
            });

            // Clean up whitespace
            element.innerHTML = element.innerHTML
            .replace(/\s+/g, ' ')
            .replace(/>\s+</g, '><')
            .trim();

            return element;
        };

        // Clean the parsed content
        const cleanedContent = postCleanup(tempDiv);

        // Use the preserved metadata for final output
        const finalMetadata = {
            title: preservedMetadata.ogTitle || preservedMetadata.twitterTitle || preservedMetadata.title || 'Untitled',
            byline: preservedMetadata.byline || preservedMetadata.metaAuthor || preservedMetadata.dcCreator || '',
            siteName: preservedMetadata.ogSiteName || preservedMetadata.siteName || window.location.hostname.replace('www.', ''),
            description: preservedMetadata.ogDescription || preservedMetadata.excerpt || preservedMetadata.metaDescription || '',
            publishDate: preservedMetadata.publishDate || preservedMetadata.dcDate || new Date().toISOString()
        };

        // Sanitize the metadata
        const sanitizedMetadata = {
            title: finalMetadata.title?.replace(/\s+/g, ' ').trim(),
            byline: finalMetadata.byline?.replace(/\s+/g, ' ').trim(),
            siteName: finalMetadata.siteName?.trim(),
            description: finalMetadata.description?.replace(/\s+/g, ' ').trim(),
            publishDate: finalMetadata.publishDate
        };

        // Create filename
        const fileName = `${sanitizedMetadata.title} - ${sanitizedMetadata.siteName}.txt`
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, ' ');

        console.log('Filename will be:', fileName);

        // Construct the markdown content
        let markdownContent = `# ${sanitizedMetadata.title}\n\n`;

        if (sanitizedMetadata.byline) {
            markdownContent += `Author: ${sanitizedMetadata.byline}\n`;
        }
        if (sanitizedMetadata.publishDate) {
            markdownContent += `Date: ${sanitizedMetadata.publishDate}\n`;
        }
        markdownContent += `Source: ${sanitizedMetadata.siteName}\n`;
        markdownContent += `URL: ${preservedMetadata.canonicalUrl || document.URL}\n`;
        markdownContent += `Date saved: ${new Date().toISOString()}\n\n`;

        if (sanitizedMetadata.description) {
            markdownContent += `> ${sanitizedMetadata.description}\n\n`;
        }
        markdownContent += `---\n\n`;

        console.log('Converting to Markdown...');
        markdownContent += turndownService.turndown(cleanedContent.innerHTML);
        console.log('Conversion complete');

        return {
            content: markdownContent,
            fileName: fileName
        };

    } catch (error) {
        console.error('Error converting page to Markdown:', error);
        throw error;
    }
}
