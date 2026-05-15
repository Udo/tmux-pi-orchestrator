<?php
	URL::$route['page-title'] = 'tmux Sessions';
	include_css('orchestrator.css');
	include_js('js/tmux-orchestrator.js');
	$api_url = URL::Link('api');
?>

<section class="tmux-app" id="tmux-app" data-api-url="<?= asafe($api_url) ?>" data-csrf="<?= asafe($_SESSION['csrf_token'] ?? '') ?>">
	<header class="tmux-hero">
		<div>
			<p class="eyebrow">same-host tmux control</p>
			<h1>Remote CLI sessions from your mobile browser</h1>
			<p>Inspect bash, pi, Claude, Codex, and other long-running terminal agents, then send the next prompt without opening SSH on the phone.</p>
		</div>
		<div class="tmux-actions">
			<button type="button" class="button" data-refresh>Refresh</button>
			<label class="auto-refresh"><input type="checkbox" data-auto-refresh checked> Auto</label>
		</div>
	</header>

	<div class="tmux-status" data-status>Loading tmux sessions…</div>

	<div class="tmux-layout">
		<aside class="tmux-panel sessions-panel">
			<div class="panel-title-row">
				<h2>Sessions</h2>
				<button type="button" class="button subtle" data-open-create>New</button>
			</div>
			<div class="session-list" data-sessions></div>
		</aside>

		<main class="tmux-panel terminal-panel">
			<div class="panel-title-row terminal-toolbar">
				<div>
					<h2 data-current-title>No pane selected</h2>
					<p data-current-meta></p>
				</div>
				<select data-pane-select aria-label="tmux pane"></select>
			</div>
			<pre class="terminal-output" data-output aria-live="polite"></pre>
			<form class="send-form" data-send-form>
				<textarea data-input rows="3" placeholder="Type a prompt or shell command. Shift+Enter for newline; Enter sends." autocomplete="off"></textarea>
				<div class="send-actions">
					<label><input type="checkbox" data-send-enter checked> send Enter</label>
					<button type="submit" class="button primary">Send</button>
				</div>
			</form>
		</main>
	</div>

	<dialog class="create-dialog" data-create-dialog>
		<form method="dialog" data-create-form>
			<h2>Create tmux session</h2>
			<label>Session name <input name="name" required pattern="[A-Za-z0-9_.:-]+" placeholder="agent-work"></label>
			<label>Startup command <input name="command" placeholder="bash"></label>
			<p class="hint">Leave the command blank for tmux's default shell. Names are restricted to safe tmux target characters.</p>
			<div class="send-actions">
				<button type="button" class="button subtle" data-close-create>Cancel</button>
				<button type="submit" class="button primary">Create</button>
			</div>
		</form>
	</dialog>
</section>
