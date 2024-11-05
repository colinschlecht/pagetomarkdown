browser.browserAction.onClicked.addListener(async (tab) => {
    try {
        // Get the current page URL
        const url = tab.url;

        // Construct the API URL - setting title=false since we'll add it manually
        const apiUrl = `https://urltomarkdown.herokuapp.com/?url=${encodeURIComponent(url)}&links=false&title=false`;

        // Fetch the markdown content
        const response = await fetch(apiUrl);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Get the page title from the response header
        const pageTitle = response.headers.get('X-Title') || 'Untitled Page';

        function cleanFileName(pageTitle) {
            // First decode any URL encoded characters
            let decoded = decodeURIComponent(pageTitle);

            // Replace HTML entities if any exist
            decoded = decoded
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

            // Replace unsafe characters for Windows/Unix filesystems
            decoded = decoded
            .replace(/[/\\:*?"<>|]/g, '-')  // Replace unsafe chars with hyphen
            .replace(/\s+/g, '_')           // Replace spaces with underscore
            .replace(/-+/g, '-')            // Replace multiple hyphens with single hyphen
            .replace(/_+/g, '_')            // Replace multiple underscores with single underscore
            .trim()                         // Remove leading/trailing whitespace
            .replace(/^-+|-+$/g, '');       // Remove leading/trailing hyphens

            // Limit length while preserving words where possible
            if (decoded.length > 100) {
                decoded = decoded.substring(0, 97) + '...';
            }

            return decoded;
        }

        // Get the markdown content
        let markdown = await response.text();

        // Decode the title first
        const decodedPageTitle = decodeURIComponent(pageTitle);

        console.log('Decoded title:', decodedPageTitle);

        // Add the title and blank line at the start of the content
        markdown = `# ${decodedPageTitle}\n\n${markdown}`;

        // Create a blob from the markdown content
        const blob = new Blob([markdown], { type: 'text/markdown' });

        // Create the download URL
        const downloadUrl = URL.createObjectURL(blob);

        // Usage in your extension
        const downloadFilename = `${cleanFileName(pageTitle)}.md`;

        // Trigger the download
        await browser.downloads.download({
            url: downloadUrl,
            filename: downloadFilename,
            saveAs: false
        });

        // Clean up the object URL
        URL.revokeObjectURL(downloadUrl);

    } catch (error) {
        console.error('Error downloading markdown:', error);
        browser.notifications.create({
            type: 'basic',
            title: 'Markdown Download Error',
            message: 'Failed to download the page as markdown. Please try again.'
        });
    }
});
