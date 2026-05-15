(() => {
	function bootTmuxOrchestrator() {
	const app = document.querySelector('#tmux-app');
	if (!app) return;

	const apiUrl = app.dataset.apiUrl;
	let csrf = app.dataset.csrf || '';
	let selectedSession = '';
	let selectedTarget = '';
	let timer = null;
	let lastContent = '';

	const els = {
		status: app.querySelector('[data-status]'),
		sessions: app.querySelector('[data-sessions]'),
		output: app.querySelector('[data-output]'),
		paneSelect: app.querySelector('[data-pane-select]'),
		title: app.querySelector('[data-current-title]'),
		meta: app.querySelector('[data-current-meta]'),
		form: app.querySelector('[data-send-form]'),
		input: app.querySelector('[data-input]'),
		enter: app.querySelector('[data-send-enter]'),
		auto: app.querySelector('[data-auto-refresh]'),
		refresh: app.querySelector('[data-refresh]'),
		dialog: app.querySelector('[data-create-dialog]'),
		createForm: app.querySelector('[data-create-form]')
	};

	function setStatus(message, error = false) {
		els.status.textContent = message;
		els.status.classList.toggle('error', error);
	}

	async function request(action, payload = {}, method = 'GET') {
		const options = { method, headers: {} };
		let url = apiUrl;
		if (method === 'GET') {
			const params = new URLSearchParams({ action, ...payload });
			url += (url.includes('?') ? '&' : '?') + params.toString();
		} else {
			options.headers['Content-Type'] = 'application/json';
			options.headers['X-CSRF-Token'] = csrf;
			options.body = JSON.stringify({ action, csrf, ...payload });
		}
		const response = await fetch(url, options);
		const data = await response.json();
		if (data.csrf) csrf = data.csrf;
		if (!data.ok) throw new Error(data.error || `Request failed (${response.status})`);
		return data;
	}

	function renderSessions(sessions) {
		els.sessions.innerHTML = '';
		if (!sessions.length) {
			els.sessions.innerHTML = '<p class="hint">No tmux sessions yet. Create one to start.</p>';
			return;
		}
		for (const session of sessions) {
			const card = document.createElement('button');
			card.type = 'button';
			card.className = 'session-card' + (session.name === selectedSession ? ' active' : '');
			card.innerHTML = `<span class="kill" title="Kill session">×</span><strong></strong><span></span>`;
			card.querySelector('strong').textContent = session.name;
			card.querySelector('span:last-child').textContent = `${session.windows} window(s), ${session.attached} attached`;
			card.addEventListener('click', async (event) => {
				if (event.target.classList.contains('kill')) {
					if (confirm(`Kill tmux session ${session.name}?`)) {
						await request('kill-session', { name: session.name }, 'POST');
						selectedSession = '';
						await refresh();
					}
					return;
				}
				selectedSession = session.name;
				selectedTarget = '';
				await refresh();
			});
			els.sessions.appendChild(card);
		}
	}

	function renderPanes(panes) {
		els.paneSelect.innerHTML = '';
		for (const pane of panes) {
			const option = document.createElement('option');
			option.value = pane.target;
			option.textContent = `${pane.target} · ${pane.command} · ${pane.path}`;
			option.selected = pane.target === selectedTarget;
			els.paneSelect.appendChild(option);
		}
		els.paneSelect.disabled = panes.length === 0;
	}

	async function refresh() {
		try {
			const data = await request('snapshot', { session: selectedSession, target: selectedTarget, lines: 220 });
			selectedSession = data.selected_session || '';
			selectedTarget = data.selected_target || '';
			renderSessions(data.sessions || []);
			renderPanes(data.panes || []);
			const content = data.capture?.content || '';
			els.title.textContent = selectedTarget || 'No pane selected';
			els.meta.textContent = selectedSession ? `Session: ${selectedSession}` : 'Create or select a tmux session.';
			if (content !== lastContent) {
				els.output.textContent = content || 'No output captured.';
				els.output.scrollTop = els.output.scrollHeight;
				lastContent = content;
			}
			setStatus(`Updated ${new Date().toLocaleTimeString()}`);
		} catch (error) {
			setStatus(error.message, true);
		}
	}

	els.paneSelect.addEventListener('change', () => {
		selectedTarget = els.paneSelect.value;
		refresh();
	});
	els.refresh.addEventListener('click', refresh);
	els.auto.addEventListener('change', () => {
		if (timer) clearInterval(timer);
		timer = els.auto.checked ? setInterval(refresh, 2500) : null;
	});
	els.form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (!selectedTarget || !els.input.value) return;
		try {
			await request('send', { target: selectedTarget, text: els.input.value, enter: els.enter.checked ? 1 : 0 }, 'POST');
			els.input.value = '';
			await refresh();
		} catch (error) {
			setStatus(error.message, true);
		}
	});
	els.input.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			els.form.requestSubmit();
		}
	});
	app.querySelector('[data-open-create]').addEventListener('click', () => els.dialog.showModal());
	app.querySelector('[data-close-create]').addEventListener('click', () => els.dialog.close());
	els.createForm.addEventListener('submit', async (event) => {
		event.preventDefault();
		const form = new FormData(els.createForm);
		try {
			await request('create-session', { name: form.get('name'), command: form.get('command') }, 'POST');
			selectedSession = String(form.get('name') || '');
			els.dialog.close();
			els.createForm.reset();
			await refresh();
		} catch (error) {
			setStatus(error.message, true);
		}
	});

	refresh();
	timer = setInterval(refresh, 2500);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', bootTmuxOrchestrator, { once: true });
	} else {
		bootTmuxOrchestrator();
	}
})();
