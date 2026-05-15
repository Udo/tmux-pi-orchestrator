<?php

class TmuxOrchestrator
{
	public static function run(array $args, int $timeoutSeconds = 8, ?string $stdin = null): array
	{
		$cmd = array_merge(['tmux'], $args);
		$descriptorSpec = [
			0 => ['pipe', 'r'],
			1 => ['pipe', 'w'],
			2 => ['pipe', 'w'],
		];
		$process = proc_open($cmd, $descriptorSpec, $pipes, null, null, ['bypass_shell' => true]);
		if(!is_resource($process))
		{
			Log::debug('tmux', 'failed to start tmux process: '.implode(' ', $args));
			return ['ok' => false, 'exit' => 127, 'stdout' => '', 'stderr' => 'Unable to execute tmux.'];
		}

		if($stdin !== null)
			fwrite($pipes[0], $stdin);
		fclose($pipes[0]);
		stream_set_blocking($pipes[1], false);
		stream_set_blocking($pipes[2], false);
		$stdout = '';
		$stderr = '';
		$started = time();

		while(true)
		{
			$status = proc_get_status($process);
			$stdout .= stream_get_contents($pipes[1]);
			$stderr .= stream_get_contents($pipes[2]);
			if(!$status['running'])
				break;
			if(time() - $started > $timeoutSeconds)
			{
				proc_terminate($process);
				Log::debug('tmux', 'tmux command timed out: '.implode(' ', $args));
				return ['ok' => false, 'exit' => 124, 'stdout' => $stdout, 'stderr' => 'tmux command timed out.'];
			}
			usleep(25000);
		}

		$stdout .= stream_get_contents($pipes[1]);
		$stderr .= stream_get_contents($pipes[2]);
		fclose($pipes[1]);
		fclose($pipes[2]);
		$exitCode = proc_close($process);
		if($exitCode !== 0)
			Log::debug('tmux', 'tmux command failed ('.$exitCode.'): '.implode(' ', $args).' stderr='.$stderr);
		return ['ok' => $exitCode === 0, 'exit' => $exitCode, 'stdout' => $stdout, 'stderr' => $stderr];
	}

	public static function validName(string $name): bool
	{
		return (bool)preg_match('/^[A-Za-z0-9_.:-]{1,80}$/', $name);
	}

	public static function validTarget(string $target): bool
	{
		return (bool)preg_match('/^[A-Za-z0-9_.:-]+(?::[0-9]+)?(?:\.[0-9]+)?$/', $target);
	}

	public static function listSessions(): array
	{
		$result = self::run(['list-sessions', '-F', '#{session_name}|#{session_windows}|#{session_attached}|#{session_created}|#{session_activity}']);
		if(!$result['ok'])
		{
			if(str_contains($result['stderr'], 'no server running'))
				return [];
			throw new RuntimeException(trim($result['stderr']) ?: 'Unable to list tmux sessions.');
		}
		$sessions = [];
		foreach(explode("\n", trim($result['stdout'])) as $line)
		{
			if($line === '') continue;
			[$name, $windows, $attached, $created, $activity] = array_pad(explode('|', $line), 5, '');
			$sessions[] = [
				'name' => $name,
				'windows' => (int)$windows,
				'attached' => (int)$attached,
				'created' => (int)$created,
				'activity' => (int)$activity,
			];
		}
		return $sessions;
	}

	public static function listPanes(string $session): array
	{
		if(!self::validName($session))
			throw new InvalidArgumentException('Invalid session name.');
		$result = self::run(['list-panes', '-a', '-F', '#{session_name}|#{window_index}|#{window_name}|#{pane_index}|#{pane_id}|#{pane_current_command}|#{pane_current_path}|#{pane_active}']);
		if(!$result['ok'])
			throw new RuntimeException(trim($result['stderr']) ?: 'Unable to list tmux panes.');
		$panes = [];
		foreach(explode("\n", trim($result['stdout'])) as $line)
		{
			if($line === '') continue;
			[$s, $windowIndex, $windowName, $paneIndex, $paneId, $command, $path, $active] = array_pad(explode('|', $line), 8, '');
			if($s !== $session) continue;
			$panes[] = [
				'target' => $s.':'.$windowIndex.'.'.$paneIndex,
				'window' => (int)$windowIndex,
				'window_name' => $windowName,
				'pane' => (int)$paneIndex,
				'pane_id' => $paneId,
				'command' => $command,
				'path' => $path,
				'active' => $active === '1',
			];
		}
		return $panes;
	}

	public static function capture(string $target, int $lines = 160): array
	{
		if(!self::validTarget($target))
			throw new InvalidArgumentException('Invalid pane target.');
		$lines = max(20, min(1000, $lines));
		$result = self::run(['capture-pane', '-p', '-e', '-t', $target, '-S', '-'.$lines]);
		if(!$result['ok'])
			throw new RuntimeException(trim($result['stderr']) ?: 'Unable to capture tmux pane.');
		return ['target' => $target, 'lines' => $lines, 'content' => rtrim($result['stdout'], "\n")];
	}

	public static function send(string $target, string $text, bool $enter = true): void
	{
		if(!self::validTarget($target))
			throw new InvalidArgumentException('Invalid pane target.');
		if(strlen($text) > 8000)
			throw new InvalidArgumentException('Input is too large.');
		if($text !== '')
		{
			$bufferName = 'tmux-pi-orchestrator-'.bin2hex(random_bytes(6));
			$result = self::run(['load-buffer', '-b', $bufferName, '-'], 8, $text);
			if(!$result['ok'])
				throw new RuntimeException(trim($result['stderr']) ?: 'Unable to load text into tmux paste buffer.');
			$result = self::run(['paste-buffer', '-d', '-b', $bufferName, '-t', $target]);
			if(!$result['ok'])
				throw new RuntimeException(trim($result['stderr']) ?: 'Unable to paste text into tmux pane.');
		}
		if($enter)
		{
			$result = self::run(['send-keys', '-t', $target, 'Enter']);
			if(!$result['ok'])
				throw new RuntimeException(trim($result['stderr']) ?: 'Unable to send Enter to tmux pane.');
		}
	}

	public static function createSession(string $name, string $command = ''): void
	{
		if(!self::validName($name))
			throw new InvalidArgumentException('Use only letters, numbers, dot, underscore, colon, and dash in session names.');
		$args = ['new-session', '-d', '-s', $name];
		if(trim($command) !== '')
			$args[] = $command;
		$result = self::run($args);
		if(!$result['ok'])
			throw new RuntimeException(trim($result['stderr']) ?: 'Unable to create tmux session.');
	}

	public static function killSession(string $name): void
	{
		if(!self::validName($name))
			throw new InvalidArgumentException('Invalid session name.');
		$result = self::run(['kill-session', '-t', $name]);
		if(!$result['ok'])
			throw new RuntimeException(trim($result['stderr']) ?: 'Unable to kill tmux session.');
	}
}
