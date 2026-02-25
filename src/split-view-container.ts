/**
 * Split View Container Component
 *
 * Orchestrates the two-pane layout: scrollable history pane (top) and editor (bottom).
 * Handles focus management, input routing, and dynamic layout calculations.
 */

import type { Component, TUI } from "@mariozechner/pi-tui";
import { matchesKey, Key } from "@mariozechner/pi-tui";
import { CustomEditor } from "@mariozechner/pi-coding-agent";

/**
 * Interface for the History Pane component.
 * The actual implementation is in TODO-096245b2 (src/history-pane.ts).
 */
export interface HistoryPane extends Component {
	/**
	 * Set the viewport height for the history pane.
	 * This controls how many rows the pane should render (including scroll indicator).
	 */
	viewportHeight: number;

	/**
	 * Render the history pane to the given width.
	 * Returns an array of lines (already includes scroll indicator if applicable).
	 */
	render(width: number): string[];

	/**
	 * Handle keyboard input (Up/Down/PgUp/PgDn for scrolling).
	 */
	handleInput(data: string): void;

	/**
	 * Invalidate cached state.
	 */
	invalidate(): void;
}

export type FocusState = "history" | "editor";

export interface SplitViewContainerOptions {
	/**
	 * Border color styling function for the editor.
	 * Applied based on focus state (accent when focused, dim when not).
	 */
	accentBorderColor: (str: string) => string;
	dimBorderColor: (str: string) => string;
}

/**
 * SplitViewContainer - Main container component for the split view layout.
 *
 * Layout:
 * - Top: Scrollable history pane (min 3 rows)
 * - Bottom: Editor with borders (dynamic height based on content)
 * - Total height: terminal.rows - 1 (footer is external, pi-managed)
 *
 * Focus:
 * - Tab switches focus between history and editor
 * - Visual indicator via editor border color
 * - Input routed to active pane
 *
 * Editor events:
 * - onSubmit -> done(text)
 * - onEscape -> done(null) (only fires when autocomplete is NOT showing)
 *
 * Note: Using CustomEditor instead of Editor to properly handle Escape:
 * - CustomEditor checks isShowingAutocomplete() before firing onEscape
 * - If autocomplete is showing, Escape dismisses it instead of closing the view
 * - onEscape only fires when autocomplete is NOT showing
 */
export class SplitViewContainer implements Component {
	private currentFocus: FocusState = "history";
	private historyPane: HistoryPane;
	private editor: CustomEditor;
	private tui: TUI;
	private done: (result: string | null) => void;
	private accentBorderColor: (str: string) => string;
	private dimBorderColor: (str: string) => string;
	private readonly minHistoryHeight = 3;

	constructor(
		historyPane: HistoryPane,
		editor: CustomEditor,
		tui: TUI,
		done: (result: string | null) => void,
		options: SplitViewContainerOptions
	) {
		this.historyPane = historyPane;
		this.editor = editor;
		this.tui = tui;
		this.done = done;
		this.accentBorderColor = options.accentBorderColor;
		this.dimBorderColor = options.dimBorderColor;

		// Set up editor callbacks
		this.editor.onSubmit = (text: string) => {
			this.done(text);
		};

		// Set up escape handler (CustomEditor handles autocomplete dismissal internally)
		// Returns current editor text so the extension shell can put it back in the main editor
		this.editor.onEscape = () => {
			this.done(this.editor.getText());
		};

		// Update editor border color based on initial focus
		this.updateBorderColors();
	}

	/**
	 * Update editor border color based on current focus state.
	 */
	private updateBorderColors(): void {
		if (this.currentFocus === "editor") {
			this.editor.borderColor = this.accentBorderColor;
		} else {
			this.editor.borderColor = this.dimBorderColor;
		}
	}

	/**
	 * Toggle focus between history and editor.
	 */
	private toggleFocus(): void {
		this.currentFocus = this.currentFocus === "history" ? "editor" : "history";
		this.updateBorderColors();
	}

	/**
	 * Render the split view layout.
	 *
	 * Calculates dynamic heights:
	 * - Total height = terminal.rows - 1 (footer is external)
	 * - Editor renders with its own borders (included in its output)
	 * - History pane gets remaining space (min 3 rows)
	 */
	render(width: number): string[] {
		// Calculate total available height (terminal rows minus footer)
		const totalHeight = this.tui.terminal.rows - 1;

		// Render editor first to determine its actual height (includes borders)
		const editorLines = this.editor.render(width);
		const editorHeight = editorLines.length;

		// Calculate history pane height (remainder, with minimum constraint)
		let historyHeight = totalHeight - editorHeight;

		// Ensure minimum history height
		if (historyHeight < this.minHistoryHeight) {
			historyHeight = this.minHistoryHeight;
			// Note: If terminal is too small, we prioritize history visibility
			// and the editor will be squeezed or partially hidden
		}

		// Set viewport height for history pane and render
		this.historyPane.viewportHeight = historyHeight;
		const historyLines = this.historyPane.render(width);

		// Combine: history on top, editor on bottom
		const result = [...historyLines, ...editorLines];

		// Pad or truncate to exact total height
		while (result.length < totalHeight) {
			result.push(" ".repeat(width));
		}

		// Truncate if somehow we exceeded (shouldn't happen, but defensive)
		if (result.length > totalHeight) {
			return result.slice(0, totalHeight);
		}

		return result;
	}

	/**
	 * Handle keyboard input.
	 *
	 * Global (either pane):
	 * - Ctrl+Shift+H: Dismiss split view (toggle hotkey)
	 * - Tab: Toggle focus between history and editor
	 *
	 * History focused:
	 * - Escape/Enter: Dismiss split view
	 * - Up/Down/PgUp/PgDn: Scroll history
	 *
	 * Editor focused:
	 * - All input delegated to CustomEditor
	 * - Escape: Handled by editor.onEscape (dismisses autocomplete first if showing)
	 * - Enter: Handled by editor.onSubmit (dismisses split view)
	 */
	handleInput(data: string): void {
		// Ctrl+Shift+H dismisses from either pane (toggle hotkey)
		if (matchesKey(data, Key.ctrlShift("h"))) {
			this.done(this.editor.getText());
			return;
		}

		// Tab switches focus
		if (matchesKey(data, Key.tab)) {
			this.toggleFocus();
			this.tui.requestRender();
			return;
		}

		// Route input based on focus
		if (this.currentFocus === "history") {
			// Escape or Enter in history pane dismisses split view
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "q") {
				this.done(this.editor.getText());
				return;
			}

			// Navigation keys scroll history (arrow keys, Page Up/Down, vim keybinds)
			if (
				matchesKey(data, Key.up) ||
				matchesKey(data, Key.down) ||
				matchesKey(data, Key.pageUp) ||
				matchesKey(data, Key.pageDown) ||
				data === "j" ||
				data === "k" ||
				data === "J" ||
				data === "K" ||
				data === "g" ||
				data === "G"
			) {
				this.historyPane.handleInput(data);
			}
			// Other keys are ignored when history is focused
		} else {
			// currentFocus === 'editor'
			// Delegate all input to editor (including Escape and Enter)
			// CustomEditor handles autocomplete dismissal before firing onEscape
			// Editor.onSubmit fires on Enter
			this.editor.handleInput(data);
		}
	}

	/**
	 * Invalidate cached state in both child components.
	 */
	invalidate(): void {
		this.historyPane.invalidate();
		this.editor.invalidate();
	}

	/**
	 * Get current focus state (for testing/debugging).
	 */
	getFocus(): FocusState {
		return this.currentFocus;
	}

	/**
	 * Set focus programmatically (for testing or initial setup).
	 */
	setFocus(focus: FocusState): void {
		this.currentFocus = focus;
		this.updateBorderColors();
		this.tui.requestRender();
	}
}
