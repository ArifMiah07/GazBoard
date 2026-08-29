window.__errors = [];
addEventListener('error', (e) => window.__errors.push(String(e.message) + ' @ ' + (e.filename || '') + ':' + (e.lineno || '')));
addEventListener('unhandledrejection', (e) => window.__errors.push('promise: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason))));
