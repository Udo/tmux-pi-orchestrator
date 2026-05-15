<?php

require __DIR__.'/bootstrap.php';

function test_fail($message)
{
	fwrite(STDERR, "FAIL: {$message}\n");
	exit(1);
}

function test_assert($condition, $message)
{
	if(!$condition)
		test_fail($message);
	echo "ok - {$message}\n";
}

function reset_request($request_uri)
{
	$_SERVER['REQUEST_URI'] = $request_uri;
	$_GET = array();
	$_POST = array();
	$_REQUEST = array();
	URL::$route = array();
	URL::$locator = '';
	URL::MakeRoute();
}

reset_request('/tmux-pi-orchestrator/?');
$home_route = URL::ResolveViewFile('views');
test_assert($home_route !== false && $home_route['file'] === 'views/index.php', 'home route resolves to the tmux console');

reset_request('/tmux-pi-orchestrator/?api&action=snapshot');
$api_route = URL::ResolveViewFile('views');
test_assert($api_route !== false && $api_route['file'] === 'views/api.php', 'API route resolves');

test_assert(URL::Link('api', ['action' => 'snapshot']) === '/tmux-pi-orchestrator/?api&action=snapshot', 'query route links keep route segment and parameters');
test_assert(cfg('site/name') === 'tmux pi Orchestrator', 'application name is configured');
test_assert(!empty($_SESSION['csrf_token']) && strlen($_SESSION['csrf_token']) >= 32, 'CSRF token is initialized');

test_assert(TmuxOrchestrator::validName('agent-work_01'), 'tmux session name validator accepts safe names');
test_assert(!TmuxOrchestrator::validName('bad name;rm'), 'tmux session name validator rejects shell-like names');
test_assert(TmuxOrchestrator::validTarget('agent:0.1'), 'tmux target validator accepts session window pane targets');
test_assert(!TmuxOrchestrator::validTarget('../agent'), 'tmux target validator rejects path-like targets');

$portal_dark = cfg('theme/options/portal-dark');
test_assert(!empty($portal_dark['description']) && !empty($portal_dark['footer_text']), 'theme metadata is available');

echo "All smoke tests passed.\n";
