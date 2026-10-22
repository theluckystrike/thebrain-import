# thebrain-import

## 1.1.1

### Patch Changes

- Release again so that the community directory can scan it. The 1.1.0 scan could not install dependencies on the scanner side. No code change.

## 1.1.0

### Minor Changes

- After a minor or major update, TheBrain Import opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings. Add the Send feedback command. The plugin makes no new network requests.

## 1.0.4

### Patch Changes

- b5daee9: Correct the README installation instructions to use the public Obsidian community directory listing. Keep the manual install route and minimum app version.

## 1.0.3

### Patch Changes

- fa659a9: Upgrade fflate to 0.8.3, outside the range of a published vulnerability advisory.

## 1.0.2

### Patch Changes

- 85e6f8b: Treat a GitHub sponsorship reply without an amount as a failed check, not a refusal, and stop the GitHub sign in when the settings close or the plugin unloads.

## 1.0.1

### Patch Changes

- 49e251e: Do not count or write a note body with only white space, and release the selected export when the dialog closes during the file read.
