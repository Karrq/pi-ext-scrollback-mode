/**
 * History Pane Component
 *
 * Renders conversation history using pi's rendering components for the
 * scrollback mode. Implements viewport-based rendering with keyboard scrolling.
 */

import type { Component, TUI, MarkdownTheme } from "@mariozechner/pi-tui";
import { matchesKey, Key, Spacer } from "@mariozechner/pi-tui";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
	SessionEntry,
	SessionMessageEntry,
	CompactionEntry,
	BranchSummaryEntry,
} from "@mariozechner/pi-coding-agent";
import {
	parseSkillBlock,
	type ParsedSkillBlock,
	UserMessageComponent,
	AssistantMessageComponent,
	ToolExecutionComponent,
	type ToolExecutionOptions,
	BashExecutionComponent,
	CompactionSummaryMessageComponent,
	BranchSummaryMessageComponent,
	CustomMessageComponent,
	SkillInvocationMessageComponent,
} from "@mariozechner/pi-coding-agent";

/**
 * Message types from pi-coding-agent (not all are exported in main index)
 */
interface CompactionSummaryMessage {
	role: "compactionSummary";
	summary: string;
	tokensBefore: number;
	timestamp: number;
}

interface BranchSummaryMessage {
	role: "branchSummary";
	summary: string;
	fromId: string;
	timestamp: number;
}

interface BashExecutionMessage {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	fullOutputPath?: string;
	timestamp: number;
	excludeFromContext?: boolean;
}

interface CustomMessage<T = unknown> {
	role: "custom";
	customType: string;
	content: string | Array<{ type: string; text?: string }>;
	display: boolean;
	details?: T;
	timestamp: number;
}

/**
 * Type guard for AssistantMessage
 */
function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant";
}

/**
 * Type guard for BashExecutionMessage
 */
function isBashExecutionMessage(message: AgentMessage): message is BashExecutionMessage {
	return message.role === "bashExecution";
}

/**
 * Type guard for CustomMessage
 */
function isCustomMessage(message: AgentMessage): message is CustomMessage {
	return message.role === "custom";
}

/**
 * Type guard for CompactionSummaryMessage
 */
function isCompactionSummaryMessage(message: AgentMessage): message is CompactionSummaryMessage {
	return message.role === "compactionSummary";
}

/**
 * Type guard for BranchSummaryMessage
 */
function isBranchSummaryMessage(message: AgentMessage): message is BranchSummaryMessage {
	return message.role === "branchSummary";
}

/**
 * Extract text content from user message
 */
function getUserMessageText(message: AgentMessage): string | null {
	if (message.role !== "user") return null;

	for (const content of message.content) {
		if (content.type === "text") {
			return content.text;
		}
	}
	return null;
}

/**
 * Message descriptor - holds data needed to create a component
 */
interface MessageDescriptor {
	type:
		| "user"
		| "user-skill"
		| "assistant"
		| "tool"
		| "bash"
		| "compaction"
		| "branch"
		| "custom"
		| "spacer";
	data: unknown;
	lineCount?: number; // Cached line count after rendering
	cachedLines?: string[]; // Cached rendered output
}

/**
 * HistoryPane - Scrollable history viewer component
 *
 * Renders session entries using pi's rendering components with viewport-based scrolling.
 */
export class HistoryPane implements Component {
	private descriptors: MessageDescriptor[] = [];
	private totalLines = 0;
	private scrollOffset = 0; // Current scroll position in lines (0 = top)
	private tui: TUI;
	private markdownTheme: MarkdownTheme;
	private toolsExpanded: boolean;
	private hideThinkingBlock: boolean;
	private cwd?: string;

	// Viewport management
	public viewportHeight: number = 10; // Set by parent ScrollbackContainer
	private lastWidth: number = 0; // Track width for re-rendering
	private needsScrollToBottom: boolean = true; // Scroll to bottom on first render

	// Styling - set by parent to match theme
	public dimText: (s: string) => string = (s) => `\x1b[2m${s}\x1b[22m`;

	constructor(
		sessionEntries: SessionEntry[],
		tui: TUI,
		markdownTheme: MarkdownTheme,
		toolsExpanded: boolean,
		hideThinkingBlock: boolean,
		cwd?: string
	) {
		this.tui = tui;
		this.markdownTheme = markdownTheme;
		this.toolsExpanded = toolsExpanded;
		this.hideThinkingBlock = hideThinkingBlock;
		this.cwd = cwd;

		// Build message descriptors from session entries
		this.buildDescriptors(sessionEntries);
	}

	/**
	 * Build message descriptors from session entries
	 */
	private buildDescriptors(entries: SessionEntry[]): void {
		// First pass: collect all messages
		const messages: AgentMessage[] = [];
		for (const entry of entries) {
			if (entry.type === "message") {
				messages.push(entry.message);
			}
		}

		// Build a map of tool results by toolCallId
		const toolResults = new Map<string, AgentMessage>();
		for (const msg of messages) {
			if (msg.role === "toolResult") {
				toolResults.set((msg as any).toolCallId, msg);
			}
		}

		// Second pass: build descriptors
		for (const entry of entries) {
			if (entry.type === "message") {
				this.buildMessageDescriptor(entry, toolResults);
			} else if (entry.type === "compaction") {
				this.buildCompactionDescriptor(entry);
			} else if (entry.type === "branch_summary") {
				this.buildBranchSummaryDescriptor(entry);
			}
			// Skip other entry types (thinking_level_change, model_change, etc.)
		}
	}

	/**
	 * Build descriptor for a session message entry
	 */
	private buildMessageDescriptor(
		entry: SessionMessageEntry,
		toolResults: Map<string, AgentMessage>
	): void {
		const message = entry.message;

		switch (message.role) {
			case "user": {
				const textContent = getUserMessageText(message);
				if (textContent) {
					const skillBlock = parseSkillBlock(textContent);
					if (skillBlock) {
						// Add spacer before skill block
						this.descriptors.push({ type: "spacer", data: 1 });
						// Add skill block component
						this.descriptors.push({ type: "user-skill", data: skillBlock });
						// Add user message if present
						if (skillBlock.userMessage) {
							this.descriptors.push({ type: "user", data: skillBlock.userMessage });
						}
					} else {
						this.descriptors.push({ type: "user", data: textContent });
					}
				}
				break;
			}
			case "assistant": {
				this.descriptors.push({ type: "assistant", data: message });
				// Extract and render tool calls separately
				if (isAssistantMessage(message)) {
					this.buildToolCallDescriptors(message, toolResults);
				}
				break;
			}
			case "bashExecution": {
				this.descriptors.push({ type: "bash", data: message });
				break;
			}
			case "custom": {
				if (message.display) {
					this.descriptors.push({ type: "custom", data: message });
				}
				break;
			}
			case "compactionSummary": {
				this.descriptors.push({ type: "spacer", data: 1 });
				this.descriptors.push({ type: "compaction", data: message });
				break;
			}
			case "branchSummary": {
				this.descriptors.push({ type: "spacer", data: 1 });
				this.descriptors.push({ type: "branch", data: message });
				break;
			}
			case "toolResult": {
				// Tool results are handled inline with their tool calls
				break;
			}
			default:
				// Skip unknown message types
				break;
		}
	}

	/**
	 * Build descriptors for tool calls within an assistant message
	 */
	private buildToolCallDescriptors(
		message: AssistantMessage,
		toolResults: Map<string, AgentMessage>
	): void {
		for (const content of message.content) {
			if (content.type === "toolCall") {
				const toolResult = toolResults.get(content.id);
				this.descriptors.push({
					type: "tool",
					data: {
						toolCall: content,
						toolResult: toolResult,
						message: message,
					},
				});
			}
		}
	}

	/**
	 * Build descriptor for a compaction entry
	 */
	private buildCompactionDescriptor(entry: CompactionEntry): void {
		// Convert CompactionEntry to CompactionSummaryMessage
		const message: CompactionSummaryMessage = {
			role: "compactionSummary",
			summary: entry.summary,
			tokensBefore: entry.tokensBefore,
			timestamp: Date.parse(entry.timestamp),
		};
		this.descriptors.push({ type: "spacer", data: 1 });
		this.descriptors.push({ type: "compaction", data: message });
	}

	/**
	 * Build descriptor for a branch summary entry
	 */
	private buildBranchSummaryDescriptor(entry: BranchSummaryEntry): void {
		// Convert BranchSummaryEntry to BranchSummaryMessage
		const message: BranchSummaryMessage = {
			role: "branchSummary",
			summary: entry.summary,
			fromId: entry.fromId,
			timestamp: Date.parse(entry.timestamp),
		};
		this.descriptors.push({ type: "spacer", data: 1 });
		this.descriptors.push({ type: "branch", data: message });
	}

	/**
	 * Render all components once and cache their output
	 */
	private renderAllComponents(): void {
		// Use the cached width (or terminal width if not set)
		const width = this.lastWidth || this.tui.terminal.width;
		this.totalLines = 0;

		for (const descriptor of this.descriptors) {
			const component = this.createComponent(descriptor);
			if (!component) {
				descriptor.cachedLines = [];
				descriptor.lineCount = 0;
				continue;
			}

			// Render the component
			const lines = component.render(width);
			descriptor.cachedLines = lines;
			descriptor.lineCount = lines.length;
			this.totalLines += lines.length;
		}
	}

	/**
	 * Create a pi component for a descriptor
	 */
	private createComponent(descriptor: MessageDescriptor): Component | null {
		switch (descriptor.type) {
			case "spacer": {
				const height = descriptor.data as number;
				return new Spacer(height);
			}
			case "user": {
				const text = descriptor.data as string;
				return new UserMessageComponent(text, this.markdownTheme);
			}
			case "user-skill": {
				const skillBlock = descriptor.data as ParsedSkillBlock;
				const component = new SkillInvocationMessageComponent(skillBlock, this.markdownTheme);
				component.setExpanded(this.toolsExpanded);
				return component;
			}
			case "assistant": {
				const message = descriptor.data as AssistantMessage;
				const component = new AssistantMessageComponent(
					message,
					this.hideThinkingBlock,
					this.markdownTheme
				);
				return component;
			}
			case "tool": {
				const data = descriptor.data as {
					toolCall: any;
					toolResult: AgentMessage | undefined;
					message: AssistantMessage;
				};
				const options: ToolExecutionOptions = { showImages: false };
				const component = new ToolExecutionComponent(
					data.toolCall.name,
					data.toolCall.arguments,
					options,
					undefined, // ToolDefinition - pass undefined as per TODO decision
					this.tui,
					this.cwd
				);
				component.setExpanded(this.toolsExpanded);

				// Update with result if available
				if (data.toolResult && data.toolResult.role === "toolResult") {
					const result = data.toolResult as any;
					if (data.message.stopReason === "aborted" || data.message.stopReason === "error") {
						let errorMessage: string;
						if (data.message.stopReason === "aborted") {
							errorMessage = "Operation aborted";
						} else {
							errorMessage = data.message.errorMessage || "Error";
						}
						component.updateResult({
							content: [{ type: "text", text: errorMessage }],
							isError: true,
						});
					} else {
						component.updateResult(result);
					}
				}

				return component;
			}
			case "bash": {
				const message = descriptor.data as BashExecutionMessage;
				const component = new BashExecutionComponent(
					message.command,
					this.tui,
					message.excludeFromContext
				);
				if (message.output) {
					component.appendOutput(message.output);
				}
				component.setComplete(
					message.exitCode,
					message.cancelled,
					message.truncated ? { truncated: true } : undefined,
					message.fullOutputPath
				);
				component.setExpanded(this.toolsExpanded);
				return component;
			}
			case "compaction": {
				const message = descriptor.data as CompactionSummaryMessage;
				const component = new CompactionSummaryMessageComponent(message, this.markdownTheme);
				component.setExpanded(this.toolsExpanded);
				return component;
			}
			case "branch": {
				const message = descriptor.data as BranchSummaryMessage;
				const component = new BranchSummaryMessageComponent(message, this.markdownTheme);
				component.setExpanded(this.toolsExpanded);
				return component;
			}
			case "custom": {
				const message = descriptor.data as CustomMessage;
				// Note: We don't have access to custom renderers here, so we pass undefined
				const component = new CustomMessageComponent(message, undefined, this.markdownTheme);
				component.setExpanded(this.toolsExpanded);
				return component;
			}
			default:
				return null;
		}
	}

	/**
	 * Render the history pane (returns viewport-visible lines)
	 */
	render(width: number): string[] {
		// Re-render components if width changed
		if (width !== this.lastWidth || this.totalLines === 0) {
			this.lastWidth = width;
			this.renderAllComponents();

			// Scroll to bottom on first render (after we know totalLines)
			if (this.needsScrollToBottom) {
				this.needsScrollToBottom = false;
				this.scrollToBottom();
			}
		}

		// Calculate the viewport
		// Reserve 2 lines: 1 for border separator, 1 for scroll indicator
		const contentHeight = this.viewportHeight - 2;
		const maxScrollOffset = Math.max(0, this.totalLines - contentHeight);

		// Clamp scroll offset
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScrollOffset));

		// Collect all cached lines
		const allLines: string[] = [];
		for (const descriptor of this.descriptors) {
			if (descriptor.cachedLines) {
				allLines.push(...descriptor.cachedLines);
			}
		}

		// Handle empty history
		if (allLines.length === 0) {
			const emptyMessage = "No messages yet";
			const result = [emptyMessage];
			// Pad to fill viewport
			while (result.length < this.viewportHeight) {
				result.push(" ".repeat(width));
			}
			return result;
		}

		// Slice to viewport
		const viewportLines = allLines.slice(this.scrollOffset, this.scrollOffset + contentHeight);

		// Pad if needed
		while (viewportLines.length < contentHeight) {
			viewportLines.push(" ".repeat(width));
		}

		// Add border separator and scroll indicator
		const border = this.dimText("─".repeat(width));
		const indicator = this.renderScrollIndicator(width);
		viewportLines.push(border);
		viewportLines.push(indicator);

		return viewportLines;
	}

	/**
	 * Render the scroll position indicator with keybind hints
	 */
	private renderScrollIndicator(width: number): string {
		const currentLine = this.scrollOffset + 1; // 1-indexed for display
		const leftText = `Line ${currentLine}/${this.totalLines}`;
		const rightText = `j/k scroll · J/K page · g/G jump · q quit`;

		// Check if we have enough width for both left and right text
		// Minimum: 1 space padding left + leftText + 2 spaces gap + rightText + 1 space padding right
		const minWidth = leftText.length + rightText.length + 4;

		if (width < minWidth) {
			// Not enough width - only show line counter (left-aligned with 1 space padding)
			return this.dimText(` ${leftText}`.padEnd(width, " "));
		}

		// Enough width - show split layout
		// Left: 1 space + leftText
		// Right: rightText + 1 space
		// Middle: fill with spaces
		const leftPart = ` ${leftText}`;
		const rightPart = `${rightText} `;
		const middleSpaces = width - leftPart.length - rightPart.length;

		return this.dimText(leftPart + " ".repeat(Math.max(0, middleSpaces)) + rightPart);
	}

	/**
	 * Handle keyboard input for scrolling
	 */
	handleInput(data: string): void {
		const contentHeight = this.viewportHeight - 2; // Reserve 2 lines: border + indicator
		const maxScrollOffset = Math.max(0, this.totalLines - contentHeight);
		const halfPage = Math.floor(contentHeight / 2);

		// Arrow keys
		if (matchesKey(data, Key.up) || data === "k") {
			this.scrollUp(1);
		} else if (matchesKey(data, Key.down) || data === "j") {
			this.scrollDown(1, maxScrollOffset);
		}
		// Page Up/Down and Shift+K/J (half-page scrolling)
		else if (matchesKey(data, Key.pageUp) || data === "K") {
			this.scrollUp(halfPage);
		} else if (matchesKey(data, Key.pageDown) || data === "J") {
			this.scrollDown(halfPage, maxScrollOffset);
		}
		// Jump to top/bottom
		else if (data === "g") {
			this.scrollToTop();
		} else if (data === "G") {
			this.scrollToBottomPosition(maxScrollOffset);
		}
	}

	/**
	 * Scroll up by the specified amount
	 */
	private scrollUp(amount: number): void {
		this.scrollOffset = Math.max(0, this.scrollOffset - amount);
		this.tui.requestRender();
	}

	/**
	 * Scroll down by the specified amount
	 */
	private scrollDown(amount: number, maxScrollOffset: number): void {
		this.scrollOffset = Math.min(maxScrollOffset, this.scrollOffset + amount);
		this.tui.requestRender();
	}

	/**
	 * Jump to the top of the history
	 */
	private scrollToTop(): void {
		this.scrollOffset = 0;
		this.tui.requestRender();
	}

	/**
	 * Jump to the bottom of the history
	 */
	private scrollToBottomPosition(maxScrollOffset: number): void {
		this.scrollOffset = maxScrollOffset;
		this.tui.requestRender();
	}

	/**
	 * Invalidate cached components (e.g., on theme change)
	 */
	invalidate(): void {
		// Clear cached lines and re-render
		for (const descriptor of this.descriptors) {
			descriptor.cachedLines = undefined;
			descriptor.lineCount = undefined;
		}
		this.totalLines = 0;
		this.renderAllComponents();
	}

	/**
	 * Scroll to bottom (most recent messages)
	 */
	private scrollToBottom(): void {
		const contentHeight = this.viewportHeight - 2;
		this.scrollOffset = Math.max(0, this.totalLines - contentHeight);
	}
}
