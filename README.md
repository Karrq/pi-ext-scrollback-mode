# pi-ext-scrollback-mode

A [pi](https://github.com/badlogic/pi) extension that adds a scrollback mode for browsing your conversation history while composing the next message.

Press `Ctrl+Shift+H` to enter a split layout with a scrollable history pane on top and the editor at the bottom. Your in-progress draft is preserved - scroll through past messages, tool calls, and outputs without losing what you were typing.

History is rendered using pi's own components, so everything looks identical to the main chat view.

## Install

```bash
pi install /path/to/pi-ext-scrollback-mode
```

Or try it without installing:

```bash
pi -e /path/to/pi-ext-scrollback-mode
```

## Keybindings

### Global (either pane)

| Key | Action |
|-----|--------|
| `Ctrl+Shift+H` | Toggle scrollback mode |
| `Tab` | Switch focus between history and editor |

### History pane

| Key | Action |
|-----|--------|
| `j` / `Down` | Scroll down one line |
| `k` / `Up` | Scroll up one line |
| `J` / `Page Down` | Scroll down half a page |
| `K` / `Page Up` | Scroll up half a page |
| `g` | Jump to top |
| `G` | Jump to bottom |
| `q` / `Escape` / `Enter` | Exit scrollback mode |

### Editor pane

Standard pi editor keybindings. `Enter` submits the prompt (and exits scrollback mode). `Escape` exits scrollback mode.

## How it works

When activated, the extension snapshots the current session branch and renders it in a read-only history pane. The editor pane is a full `CustomEditor` with autocomplete, so you can compose and submit prompts without leaving scrollback mode.

Focus starts in the history pane. Press `Tab` to switch to the editor (the editor border highlights when focused). Any text you had in the main editor is carried over, and when you exit, whatever is in the editor is placed back.
