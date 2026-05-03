// MPV for language learners setup
//
// Provides following features:
//  1. One-key switch between subs you can read and
//     lang you are learning
//  2. Ability to seek to start or AB loop current subtitle
//  3. Auto AB loop mode - will loop each subtitle one by one
//  4. Open subtitle (3 keys for 3 possible sites)
//  5. One-key saving subtitle and audio in "to_learn" directory
//     for later adding to cards and so on
//  6. Ability to run external script, to create cards right
//     from MPV
//
//  To install follow MPV instructions to install scripts.
//  .js file should go into scripts/ directory,
//  .conf into script-opts/
//
// License: GNU Lesser General Public License as published
// by the Free Software Foundation; either version 2.1 of
// the License, or (at your option) any later version.

var config = {
	trace_log: true,

	learn: 'en',
	know: 'vi',
	preferred_lang: 'Vietnamese', // %p

	browser: 'x-www-browser',
	url1: 'https://jisho.org/search/%s',
	url2: 'https://translate.google.com/?sl=auto&text=%s',
	url3: 'https://chatgpt.com/?temporary-chat=true&prompt=Provide%20a%20short,%20direct%20explanation%20of%20the%20following%20phrase%20in%20%p%20-%20no%20extra%20details.:%20%0A%0A%s',

	store_dir: 'to_learn',
	script: 'echo',

	key_toggle_lang: 'b',
	key_cycle_known: 'B',
	key_seek_cur_sub: 'c',
	key_ab_loop_sub: 'g',
	key_open_url1: 'F1',
	key_open_url2: 'F2',
	key_open_url3: 'F3',
	key_auto_ab_loop: 'F5',
	key_store: 'F6',
	key_script: 'F7'
};

mp.options.read_options(config, 'lang-learner');

var is_learn_lang = false;
var data = null;

//
// Handlers for commands
//

mp.add_key_binding(config.key_toggle_lang, 'll-toggle-lang', do_toggle_lang);
mp.add_key_binding(config.key_cycle_known, 'll-cycle-known', do_cycle_known);
mp.add_key_binding(
	config.key_seek_cur_sub,
	'll-seek-cur-sub',
	do_seek_current_sub
);
mp.add_key_binding(config.key_ab_loop_sub, 'll-ab-loop-sub', do_ab_loop_sub);
mp.add_key_binding(
	config.key_auto_ab_loop,
	'll-toggle-auto-ab-loop',
	toggle_auto_ab_loop
);
mp.add_key_binding(config.key_open_url1, 'll-open-in-url1', function () {
	do_open_in_url('url1');
});
mp.add_key_binding(config.key_open_url2, 'll-open-in-url2', function () {
	do_open_in_url('url2');
});
mp.add_key_binding(config.key_open_url3, 'll-open-in-url3', function () {
	do_open_in_url('url3');
});
mp.add_key_binding(config.key_store, 'll-store', do_store);
mp.add_key_binding(config.key_script, 'll-script', do_script);

function do_toggle_lang() {
	fetch_subtitle_tracks();

	if (is_learn_lang) {
		set_slang('know');
		is_learn_lang = false;
	} else {
		set_slang('learn');
		is_learn_lang = true;
	}
}

function do_cycle_known() {
	fetch_subtitle_tracks();
	cycle_lang_type('know');
	set_slang('know');
}

function do_seek_current_sub() {
	mp.commandv('sub-seek', '0');
}

function do_ab_loop_sub() {
	if (mp.get_property('ab-loop-a') !== 'no') {
		clear_ab_loop();
		mp.osd_message('Clear AB loop', 0.5);
	} else {
		if (get_sub() === null) return;
		set_ab_loop();
		mp.osd_message('AB-Loop subtitle', 0.5);
	}
}

var auto_ab_loop_sub = false;
function toggle_auto_ab_loop() {
	if (auto_ab_loop_sub) {
		auto_ab_loop_sub = false;
		clear_ab_loop();
		mp.osd_message('Disable auto AB loop');
	} else {
		auto_ab_loop_sub = true;
		set_ab_loop();
		mp.osd_message('Enable auto AB loop');
	}
}

function do_open_in_url(urlKey) {
	if (config[urlKey] === '') return;

	var sub = get_sub();
	if (sub === null) return;

	var url = config[urlKey]
		.replace('%s', encodeURIComponent(sub.text))
		.replace('%p', encodeURIComponent(config.preferred_lang));
	print('Open URL: ' + url);
	mp.set_property('pause', 'yes');
	open_external(url);
}

function do_store() {
	var sub = get_sub();
	if (sub === null) return;
	sub.source = mp.get_property('path');

	var dir = config.store_dir;
	if (!dir) return;

	mkdir(dir);

	var now = new Date();
	var timestamp = formatCustomDate(now);

	var filename = dir + '/' + 'sub-' + timestamp;
	save_json(filename + '.json', sub);
	save_audio(filename + '.mp3', sub);
	save_sub(filename + '.txt', sub);
}

function do_script() {
	var sub = get_sub();
	if (sub === null) return;
	call_ext_script(sub);
}

//
// Event handlers
//

mp.observe_property('sub-text', 'string', on_new_sub);
mp.observe_property('ab-loop-a', 'string', on_ab_loop_a_change);

var sub_cache = {};
var sub_cache_active = false;

function on_new_sub(name, subtitleText) {
	if (!subtitleText || !sub_cache_active) return;

	if (auto_ab_loop_sub) {
		set_ab_loop();
	}

	// Cache subtitle with timing info only while collecting for A-B loop
	var sub_start = mp.get_property_number('sub-start');
	var sub_end = mp.get_property_number('sub-end');
	var key = sub_start;
	if (!sub_start || !sub_end || sub_cache[key]) return;

	sub_cache[key] = {
		text: subtitleText,
		start_time: Number(sub_start),
		end_time: Number(sub_end)
	};

	trace(
		'Cached sub: [' +
			sub_start.toFixed(3) +
			' - ' +
			sub_end.toFixed(3) +
			'] ' +
			subtitleText
	);
}

// Manage subtitle cache lifecycle based on A-B loop state
function on_ab_loop_a_change(name, val) {
	if (val !== undefined && val !== null && val !== 'no') {
		// A-B loop started: clear old cache and start caching
		sub_cache = {};
		sub_cache_active = true;
		// Cache current sub immediately
		trace('AB-loop started (a=' + val + '), cache cleared, caching ON');
		on_new_sub('initial', mp.get_property('sub-text'));
	} else {
		// A-B loop cleared: stop caching and clear cache
		auto_ab_loop_sub = false;
		sub_cache_active = false;
		sub_cache = {};
		trace('AB-loop cleared, caching OFF, cache cleared');
	}
}

//
// Helpers
//
function getCallerName() {
	var err = new Error();

	if (err.stack) {
		// Split the stack trace into an array of lines
		var stackLines = err.stack.split('\n');

		// Line 0: Error message
		// Line 1: at getCallerName (...)
		// Line 2: at LOGGER (...)
		// Line 3: at THE_ACTUAL_CALLER (...)
		if (stackLines.length >= 4) {
			// Regex to extract the function name after "at "
			var match = stackLines[3].match(/at\s+([^\s\(]+)/);
			if (match && match[1]) {
				return match[1];
			}
		}
	}
	return '';
}

function trace(msg) {
	if (!config.trace_log) return;
	// Blue color
	var caller = '\x1b[34m' + getCallerName() + '\x1b[0m';
	print(caller + ': ' + msg);
}

function log(msg) {
	var caller = '\x1b[32m' + getCallerName() + '\x1b[0m';
	mp.msg.info(caller + ': ' + msg);
}

function warn(msg) {
	var caller = '\x1b[33m' + getCallerName() + '\x1b[0m';
	mp.msg.warn(caller + ': ' + msg);
	mp.osd_message(caller + ': ' + msg, 8);
}

function error(msg) {
	var caller = '\x1b[31m' + getCallerName() + '\x1b[0m';
	mp.msg.error(caller + ': ' + msg);
	mp.osd_message(caller + ': ' + msg, 8);
}

function fatal(msg) {
	var caller = '\x1b[31m' + getCallerName() + '\x1b[0m';
	mp.msg.fatal(caller + ': ' + msg);
	mp.osd_message(caller + ': ' + msg, 8);
}

function formatCustomDate(date) {
	function padZero(num) {
		return (num < 10 ? '0' : '') + num;
	}

	var yyyy = date.getFullYear();
	// getMonth() returns [0, 11]
	var mm = padZero(date.getMonth() + 1);
	var dd = padZero(date.getDate());

	var hh = padZero(date.getHours());
	var min = padZero(date.getMinutes());
	var ss = padZero(date.getSeconds());

	return yyyy + '-' + mm + '-' + dd + '-' + hh + '-' + min + '-' + ss;
}

function fetch_subtitle_tracks() {
	if (data !== null) return;

	data = {};
	data.by_lang = {};
	var tracks = mp.get_property_native('track-list');
	for (var i = 0; i < tracks.length; i++) {
		var track = tracks[i];
		if (track.type === 'sub') {
			var lang = track.lang || 'id-' + track.id;
			data.by_lang[lang] = track;
		}
	}

	var tags = ['learn', 'know'];
	for (var i = 0; i < tags.length; i++) {
		prepare_lang_tag(tags[i]);
	}
	trace(JSON.stringify(data, null, '\t'));
}

function prepare_lang_tag(tag) {
	var res = {
		list: [],
		cur: null,
		idx: 0
	};

	var langs = config[tag].split(/\s+/);
	for (var i = 0; i < langs.length; i++) {
		var lang = langs[i];
		if (lang && data.by_lang[lang]) {
			res.list.push(lang);
		}
	}
	res.cur = res.list[0] || null;
	data[tag] = res;
}

function clear_ab_loop() {
	mp.set_property('ab-loop-a', 'no');
	mp.set_property('ab-loop-b', 'no');
}

function set_ab_loop() {
	if (mp.get_property('ab-loop-a') !== 'no') return;

	var a = mp.get_property_number('sub-start');
	var b = mp.get_property_number('sub-end');
	var delay = mp.get_property_number('sub-delay') || 0;
	if (a === undefined || b === undefined) return;

	mp.set_property('ab-loop-a', a + delay);
	mp.set_property('ab-loop-b', b + delay + 0.5);
}

function set_slang(tag) {
	var lang = data[tag].cur;

	if (lang !== null) {
		mp.set_property('sub', Number(data.by_lang[lang].id));
	} else {
		warn('Cant find sub with lang: ' + config[tag]);
	}
}

function cycle_lang_type(tag) {
	var idx = (data[tag].idx + 1) % data[tag].list.length;
	data[tag].cur = data[tag].list[idx];
	data[tag].idx = idx;
}

function get_sub() {
	// ref = [start, end], line = [start, end]
	function is_overlapped(ref, line) {
		function normalize(arr) {
			// ensure every element is a number
			// arr = arr.map(function (x) {
			// 	return Number(x);
			// });
			// sort from smaller to bigger
			return arr.sort(function (x, y) {
				return x - y;
			});
		}

		ref = normalize(ref);
		line = normalize(line);
		var s = Math.max(ref[0], line[0]);
		var e = Math.min(ref[1], line[1]);
		var overlap = Math.max(0, e - s);
		var len = line[1] - line[0];
		var per = (overlap / len) * 100;
		trace('line [' + line[0] + ',' + line[1] + '] per=' + per.toFixed(2));
		return per > 32;
	}

	var res = {};
	var a = Number(mp.get_property('ab-loop-a'));
	var b =
		Number(mp.get_property('ab-loop-b')) || mp.get_property_number('sub-end');

	if (!isNaN(a) && !isNaN(b)) {
		// A loop is active: collect all cached subtitles within the loop range
		var delay = mp.get_property_number('sub-delay') || 0;
		trace(
			'AB-loop active, a=' +
				a.toFixed(3) +
				' b=' +
				b.toFixed(3) +
				' delay=' +
				delay.toFixed(3)
		);

		var keys = Object.keys(sub_cache);
		trace('get_sub: sub_cache has ' + keys.length + ' entries');

		// Filter and sort cached subtitles by start time
		var sorted = [];
		for (var i = 0; i < keys.length; i++) {
			var entry = sub_cache[keys[i]];
			var playback_start = entry.start_time + delay;
			var playback_end = entry.end_time + delay;
			trace(entry.text);
			if (is_overlapped([a, b], [playback_start, playback_end])) {
				sorted.push(entry);
			}
		}

		if (!sorted.length) {
			warn('no subs found in AB-loop range, returning nil');
			return null;
		}

		sorted.sort(function (x, y) {
			return x.start_time - y.start_time;
		});

		var text = '';
		for (var i = 0; i < sorted.length; i++) {
			text += sorted[i].text + ' ';
		}

		res = {
			text: text,
			start: sorted[0].start_time,
			end: sorted[sorted.length - 1].end_time
		};
	} else {
		trace('no AB-loop, return current sub');
		res = {
			text: mp.get_property('sub-text'),
			start: mp.get_property('sub-start'),
			end: mp.get_property('sub-end')
		};
	}

	res.text = res.text.replace(/\s+/g, ' ').trim();
	trace(JSON.stringify(res));
	if (!res.text) {
		warn('No subtitle text found');
		return null;
	}
	return res;
}

function save_sub(filename, sub) {
	try {
		mp.utils.write_file('file://' + filename, sub.text);
		print('saved text to ' + filename);
	} catch (e) {
		error('Failed to save text: ' + e);
	}
}

function save_json(filename, sub) {
	try {
		var str = JSON.stringify(sub, null, 2);
		mp.utils.write_file('file://' + filename, str);
		log('saved JSON to ' + filename);
	} catch (e) {
		error('Failed to save JSON: ' + e);
	}
}

function save_audio(filename, sub) {
	var duration = Number(sub.end) - Number(sub.start) + 0.1;

	var ffmpeg = get_ffmpeg();
	if (ffmpeg === null) {
		error("Can't save audio: no ffmpeg");
		return;
	}
	trace('Using ffmpeg at: ' + ffmpeg);

	// Get the currently selected audio track ID from MPV
	var audio_track_id = mp.get_property('aid');

	// Map the audio track ID to ffmpeg format (e.g., if aid=2, use "0:a:1" in ffmpeg)
	var ffmpeg_audio_track = '0:a:' + (Number(audio_track_id) - 1);

	// Run the ffmpeg command with the correct audio track
	mp.commandv(
		'run',
		ffmpeg,
		'-y',
		'-loglevel',
		'error',
		'-i',
		sub.source,
		'-map',
		ffmpeg_audio_track, // Use the currently selected audio track
		'-ss',
		sub.start,
		'-t',
		String(duration),
		'-vn',
		'-ar',
		'44100',
		'-ac',
		'2',
		'-ab',
		'192k',
		'-f',
		'mp3',
		filename
	);
	log('saved audio to ' + filename);
}

//
// Cross-platform helpers
//
function is_windows() {
	return (
		mp.utils.getenv('OS') === 'Windows_NT' ||
		(mp.utils.getenv('WINDIR') !== undefined &&
			mp.utils.getenv('WINDIR') !== null)
	);
}

var ffmpeg_path = null;
function get_ffmpeg() {
	if (ffmpeg_path) return ffmpeg_path;

	var cmd = is_windows() ? 'where' : 'which';
	var result = mp.command_native({
		name: 'subprocess',
		args: [cmd, 'ffmpeg'],
		capture_stdout: true
	});
	if (result && result.status === 0 && result.stdout) {
		ffmpeg_path = result.stdout.trim().split('\n')[0];
	} else {
		ffmpeg_path = '';
	}

	return ffmpeg_path || null;
}

function mkdir(dir) {
	if (is_windows()) {
		mp.commandv('run', 'cmd', '/c', 'mkdir', dir);
	} else {
		mp.commandv('run', 'mkdir', '-p', dir);
	}
}

function open_external(url) {
	var browser = config.browser || '';
	log('Open external URL with browser: ' + browser);
	if (is_windows()) {
		if (browser === '' || browser === 'x-www-browser') {
			mp.commandv('run', 'rundll32', 'url.dll,FileProtocolHandler', url);
			return;
		}
		mp.commandv('run', browser, url);
		return;
	}

	// Linux and others
	if (browser === '') {
		browser = 'xdg-open';
	} else if (browser === 'x-www-browser') {
		browser = 'xdg-open';
	}
}

function call_ext_script(sub) {
	if (config.script === '') return;
	var videoFileName = mp.get_property('filename');

	if (is_windows()) {
		mp.commandv(
			'run',
			'cmd',
			'/d',
			'/s',
			'/c',
			'call',
			config.script,
			sub.text,
			videoFileName,
			String(sub.start),
			String(sub.end)
		);
		return;
	}

	mp.commandv(
		'run',
		config.script,
		sub.text,
		videoFileName,
		sub.start,
		sub.end
	);
}
