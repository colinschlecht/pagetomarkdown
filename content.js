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
        const img = node.querySelector('img');
        const caption = node.querySelector('figcaption');
        if (img) {
            const alt = img.getAttribute('alt') || '';
            const src = img.getAttribute('src') || '';
            const captionText = caption ? caption.textContent : '';
            return `![${alt}](${src})\n${captionText}\n\n`;
        }
        return content;
    }
});

function cleanupDocument(doc) {
    // Common selectors for unwanted content
    const selectorsToRemove = [
        // Ads
        '[class*="ad-"]',
        '[class*="ads-"]',
        '[class*="advertisement"]',
        '[id*="ad-"]',
        '[id*="ads-"]',
        // Social media
        '[class*="social"]',
        '[id*="social"]',
        // Related content
        '[class*="related"]',
        '[id*="related"]',
        '[class*="recommended"]',
        '[id*="recommended"]',
        // Comments
        '[class*="comments"]',
        '[id*="comments"]',
        // Sidebars
        'aside',
        '[class*="sidebar"]',
        '[id*="sidebar"]',
        // Navigation
        'nav',
        '[role="navigation"]',
        // Footers
        'footer',
        '[class*="footer"]',
        '[id*="footer"]',
        // Other common unwanted elements
        '[class*="popup"]',
        '[class*="modal"]',
        '[class*="newsletter"]',
        '[class*="subscribe"]',
        '[class*="share"]',
        '[class*="popular"]',
        '[class*="trending"]',
        '[class*="more-links"]',
        '[class*="outbrain"]',
        '[class*="taboola"]',
        // Common ad networks
        '[class*="doubleclick"]',
        '[class*="adsense"]'
    ];

    // Remove elements matching selectors
    selectorsToRemove.forEach(selector => {
        try {
            doc.querySelectorAll(selector).forEach(element => {
                element.remove();
            });
        } catch (e) {
            console.log(`Error removing selector ${selector}:`, e);
        }
    });

    // Remove empty paragraphs and divs
    doc.querySelectorAll('p, div').forEach(element => {
        if (element.innerHTML.trim() === '') {
            element.remove();
        }
    });

    // Remove hidden elements
    doc.querySelectorAll('*').forEach(element => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') {
            element.remove();
        }
    });

    return doc;
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Message received in content script:', message);
    if (message.action === "convert") {
        convertPageToMarkdown()
        .then(markdownData => {
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

// ... [previous code remains the same until convertPageToMarkdown function] ...

async function convertPageToMarkdown() {
    console.log('Starting conversion...');
    try {
        // Create a proper document clone
        const documentClone = document.implementation.createHTMLDocument();
        const doc = document.documentElement.cloneNode(true);
        documentClone.documentElement.replaceWith(doc);

        // Clean up the document before parsing
        cleanupDocument(documentClone);

        // Wait for any dynamic content to load
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log('Creating Readability instance...');
        const reader = new Readability(documentClone, {
            debug: true,
            charThreshold: 20,
            // Readability options for better cleaning
            keepClasses: false,
            cleanConditionally: true,
            removeEmpty: true,
            weight: {
                classes: {
                    'ad': -50,
                    'ads': -50,
                    'advertisement': -50,
                    'related': -40,
                    'recommended': -40,
                    'share': -30,
                    'social': -30
                }
            }
        });

        const article = reader.parse();
        console.log('Readability parsing complete');

        if (!article) {
            throw new Error('Could not parse page content');
        }

        // Fallback content if Readability fails to parse meaningful content
        if (!article.content || article.content.trim().length === 0) {
            console.log('Falling back to basic content extraction');
            const mainContent = document.body.innerHTML;
            article.content = mainContent;
            article.title = article.title || document.title;
        }

        // Get site name from multiple sources if not available
        let siteName = article.siteName;
        if (!siteName || siteName.trim() === '') {
            siteName = [
                document.querySelector('meta[property="og:site_name"]')?.content,
                document.querySelector('meta[name="application-name"]')?.content,
                JSON.parse(document.querySelector('script[type="application/ld+json"]')?.textContent || '{}')?.publisher?.name,
                window.location.hostname.replace('www.', '').split('.')[0],
            ].find(name => name && name.trim() !== '') || window.location.hostname.replace('www.', '');
        }

        // Clean up title and site name
        const cleanTitle = (article.title || 'Untitled').trim();
        siteName = siteName.trim();

        // Create filename with article title and site name
        const fileName = `${cleanTitle} - ${siteName}.txt`
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, ' ');

        console.log('Filename will be:', fileName);

        // Construct the markdown content
        let markdownContent = `# ${cleanTitle}\n\n`;

        // Add metadata if available
        if (article.byline) {
            markdownContent += `Author: ${article.byline}\n\n`;
        }
        markdownContent += `Source: ${siteName}\n`;
        markdownContent += `URL: ${document.URL}\n`;
        markdownContent += `Date saved: ${new Date().toISOString()}\n\n---\n\n`;

        console.log('Converting to Markdown...');
        // Convert HTML to Markdown
        markdownContent += turndownService.turndown(article.content);
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
