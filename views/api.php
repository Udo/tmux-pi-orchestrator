<?php
	URL::$page_type = 'json';
	header('Content-Type: application/json; charset=utf-8');

	function api_response(array $payload, int $status = 200): never
	{
		http_response_code($status);
		echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
		exit;
	}

	function api_require_csrf(): void
	{
		$token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_REQUEST['csrf'] ?? '');
		if(!isset($_SESSION['csrf_token']) || !hash_equals((string)$_SESSION['csrf_token'], (string)$token))
			api_response(['ok' => false, 'error' => 'Invalid or missing CSRF token. Refresh the page and try again.'], 403);
	}

	$action = (string)($_REQUEST['action'] ?? 'snapshot');
	try
	{
		switch($action)
		{
			case 'snapshot':
				$sessions = TmuxOrchestrator::listSessions();
				$session_names = array_column($sessions, 'name');
				$selected = (string)($_REQUEST['session'] ?? ($sessions[0]['name'] ?? ''));
				if($selected === '' || !in_array($selected, $session_names, true))
					$selected = (string)($sessions[0]['name'] ?? '');
				$panes = $selected !== '' ? TmuxOrchestrator::listPanes($selected) : [];
				$pane_targets = array_column($panes, 'target');
				$target = (string)($_REQUEST['target'] ?? '');
				if($target === '' || !in_array($target, $pane_targets, true))
					$target = (string)($panes[0]['target'] ?? '');
				$capture = $target !== '' ? TmuxOrchestrator::capture($target, (int)($_REQUEST['lines'] ?? 180)) : ['content' => ''];
				api_response(['ok' => true, 'sessions' => $sessions, 'selected_session' => $selected, 'panes' => $panes, 'selected_target' => $target, 'capture' => $capture, 'csrf' => $_SESSION['csrf_token'] ?? '']);

			case 'send':
				api_require_csrf();
				TmuxOrchestrator::send((string)($_POST['target'] ?? ''), (string)($_POST['text'] ?? ''), !empty($_POST['enter']));
				api_response(['ok' => true]);

			case 'create-session':
				api_require_csrf();
				TmuxOrchestrator::createSession((string)($_POST['name'] ?? ''), (string)($_POST['command'] ?? ''));
				api_response(['ok' => true]);

			case 'kill-session':
				api_require_csrf();
				TmuxOrchestrator::killSession((string)($_POST['name'] ?? ''));
				api_response(['ok' => true]);

			default:
				api_response(['ok' => false, 'error' => 'Unknown API action.'], 400);
		}
	}
	catch(Throwable $e)
	{
		Log::debug('api', $action.': '.$e->getMessage());
		api_response(['ok' => false, 'error' => $e->getMessage()], 500);
	}
