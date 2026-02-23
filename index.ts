/**
 * Split View Extension
 *
 * Adds a split view mode for browsing conversation history while composing
 * the next message. Toggle with a keyboard shortcut to enter a split layout:
 * scrollable history pane on top, editor at the bottom.
 *
 * Uses the same rendering components as the main chat for identical appearance.
 *
 * Usage:
 *   pi -e pi-ext-splitview
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	CustomEditor,
	getMarkdownTheme,
	getSelectListTheme,
} from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import type { EditorTheme } from "@mariozechner/pi-tui";
import { SplitViewContainer } from "./src/split-view-container.js";
import { HistoryPane } from "./src/history-pane.js";

export default function splitViewExtension(pi: ExtensionAPI) {
	// Register ctrl+shift+h shortcut to toggle split view
	pi.registerShortcut(Key.ctrlShift("h"), {
		description: "Toggle split view",
		handler: async (ctx) => {
			// Only open split view when agent is idle
			if (!ctx.isIdle()) {
				return;
			}

			// Only works in UI mode
			if (!ctx.hasUI) {
				return;
			}

			// Capture current editor text
			const savedEditorText = ctx.ui.getEditorText();

			// Get session entries for history pane
			const sessionEntries = ctx.sessionManager.getBranch();

			// Get current tool expand/collapse state
			const toolsExpanded = ctx.ui.getToolsExpanded();

			// Capture TUI reference for triggering render after text restore
			let tuiRef: import("@mariozechner/pi-tui").TUI;

			// Open split view custom UI
			const result = await ctx.ui.custom<string>((tui, theme, keybindings, done) => {
				tuiRef = tui;
				// Construct EditorTheme manually (getEditorTheme is not exported)
				const editorTheme: EditorTheme = {
					borderColor: (text: string) => theme.fg("borderMuted", text),
					selectList: getSelectListTheme(),
				};

				// Create embedded editor
				const editor = new CustomEditor(tui, editorTheme, keybindings);
				editor.setText(savedEditorText);

				// Get markdown theme for history rendering
				const markdownTheme = getMarkdownTheme();

				// Create history pane
				// hideThinkingBlock = false (always show thinking blocks)
				const historyPane = new HistoryPane(
					sessionEntries,
					tui,
					markdownTheme,
					toolsExpanded,
					false, // hideThinkingBlock
					ctx.cwd
				);

				// Create and return split view container
				return new SplitViewContainer(historyPane, editor, tui, done, {
					accentBorderColor: (text) => theme.fg("borderAccent", text),
					dimBorderColor: (text) => theme.fg("borderMuted", text),
				});
			});

			// Put the edited text back into the main editor
			// Note: custom() auto-restores old text via process.nextTick render,
			// which runs BEFORE this Promise continuation. So we must set the new
			// text AND trigger another render to make it visible.
			ctx.ui.setEditorText(result);
			tuiRef!.requestRender();
		},
	});
}
