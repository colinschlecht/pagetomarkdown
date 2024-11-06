browser.browserAction.onClicked.addListener((tab) => {
    console.log('Button clicked for tab:', tab.id);

    browser.tabs.sendMessage(tab.id, { action: "convert" })
    .then(response => {
        console.log('Response from content script:', response);
        if (response.success && response.markdownContent) {
            const blob = new Blob([response.markdownContent], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);

            return browser.downloads.download({
                url: url,
                filename: response.fileName,
                saveAs: false,  // Changed from true to false
                conflictAction: 'uniquify' // Automatically adds numbers to avoid conflicts
            }).finally(() => {
                URL.revokeObjectURL(url);
            });
        } else {
            console.error('Conversion failed:', response.error);
        }
    })
    .catch(error => {
        console.error('Error:', error);
    });
});
