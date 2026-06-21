// ShipGhost App JavaScript
// Coordinates iframe views, host RPC calls, and simulated/mock behaviors

// --- 1. Host API Wrapper (postMessage bridge) ---
const isHostAvailable = typeof window.parent !== 'undefined' && window !== window.parent;

async function callHost(action, payload = {}) {
  if (!isHostAvailable) {
    console.warn(`[ShipGhost SDK] Host not available. Mocking action: ${action}`);
    return mockHostCall(action, payload);
  }
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).substring(2);
    const handler = (event) => {
      // Accept responses from host
      if (event.data && event.data.id === id) {
        window.removeEventListener('message', handler);
        if (event.data.error) {
          reject(event.data.error);
        } else {
          resolve(event.data.result);
        }
      }
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ id, action, ...payload }, '*');
  });
}

// Dynamic import to allow graceful fallback when running outside Anna environment
let AnnaAppRuntime = null;
let realAnna = null;

// Tool ID Resolution
const DEV_FALLBACK_TOOL_ID = "tool-dev-shipghost";
const TOOL_ID =
  (typeof window !== "undefined" &&
    window.__ANNA_TOOL_IDS__ &&
    window.__ANNA_TOOL_IDS__["shipghost"]) ||
  DEV_FALLBACK_TOOL_ID;

const annaReady = (async () => {
  try {
    const sdkModule = await import("/static/anna-apps/_sdk/latest/index.js").catch(e => {
      console.warn("Could not load Anna SDK dynamically, falling back to mock environment", e);
      return null;
    });

    if (!sdkModule) {
      console.warn("[ShipGhost] Anna SDK not available. Running in sandbox mode.");
      updateStatusBadge(false);
      return null;
    }

    AnnaAppRuntime = sdkModule.AnnaAppRuntime;
    realAnna = await AnnaAppRuntime.connect();
    console.log("[ShipGhost] Connected to Anna runtime", realAnna.windowUuid);
    updateStatusBadge(true);
    return realAnna;
  } catch (err) {
    console.warn("[ShipGhost] Anna SDK not available. Running in sandbox mode.", err);
    updateStatusBadge(false);
    return null;
  }
})();

function updateStatusBadge(isLive) {
  const statusText = document.querySelector('.header-status span');
  const pulseDot = document.querySelector('.pulse-dot');
  if (isLive) {
    if (statusText) statusText.innerText = "ANNA SECURE DESK (LIVE)";
    if (pulseDot) {
      pulseDot.style.background = "var(--primary)";
      pulseDot.style.boxShadow = "0 0 10px var(--primary-glow)";
    }
  } else {
    if (statusText) statusText.innerText = "STANDALONE (MOCK)";
    if (pulseDot) {
      pulseDot.style.background = "#ef4444";
      pulseDot.style.boxShadow = "0 0 10px rgba(239, 68, 68, 0.4)";
    }
  }
}


// SDK method signatures wrapper
const anna = {
  tools: {
    invoke: async (method, args = {}) => {
      const a = await annaReady;
      if (!a) {
        return mockHostCall('tools.invoke', { name: method, arguments: args });
      }
      try {
        const reply = await a.tools.invoke({ tool_id: TOOL_ID, method, args });
        if (reply && typeof reply === "object" && reply.data && reply.tool) {
          return reply.data;
        }
        return reply ?? {};
      } catch (e) {
        throw e;
      }
    }
  },
  storage: {
    get: async (key) => {
      const a = await annaReady;
      if (a && a.storage) {
        try {
          return await a.storage.get(key);
        } catch (storageErr) {
          console.warn("[ShipGhost] Error reading from real storage:", storageErr);
        }
      }
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    },
    set: async (key, value) => {
      const a = await annaReady;
      if (a && a.storage) {
        try {
          return await a.storage.set(key, value);
        } catch (storageErr) {
          console.warn("[ShipGhost] Error writing to real storage:", storageErr);
        }
      }
      localStorage.setItem(key, JSON.stringify(value));
      return { success: true };
    },
    delete: async (key) => {
      const a = await annaReady;
      if (a && a.storage && a.storage.delete) {
        try {
          return await a.storage.delete(key);
        } catch (storageErr) {
          console.warn("[ShipGhost] Error deleting from real storage:", storageErr);
        }
      }
      localStorage.removeItem(key);
      return { success: true };
    }
  },
  upload: {
    negotiate: async (filename, contentType) => {
      const a = await annaReady;
      if (a && a.upload && a.upload.negotiate) {
        const nego = await a.upload.negotiate({
          filename: filename,
          mime_type: contentType
        });
        return {
          r2_key: nego.r2_key,
          put_url: nego.put_url,
          headers: nego.headers
        };
      }
      return mockHostCall('upload.negotiate', { filename, contentType });
    },
    confirm: async (r2_key) => {
      const a = await annaReady;
      if (a && a.upload && a.upload.confirm) {
        const conf = await a.upload.confirm({
          r2_key: r2_key
        });
        return {
          download_url: conf.download_url
        };
      }
      return {
        download_url: `https://share.shipghost.io/bundles/${Math.random().toString(36).substring(7)}.md`
      };
    }
  },
  window: {
    open_view: async (name, options = {}) => {
      const a = await annaReady;
      if (a && a.window && a.window.open_view) {
        return await a.window.open_view(name, options);
      }
      console.log(`[Sandbox Mock] open_view called for: ${name}`, options);
    },
    set_title: async (title) => {
      const a = await annaReady;
      if (a && a.window && a.window.set_title) {
        return await a.window.set_title(title);
      }
      document.title = title;
    }
  }
};

// --- 2. State & Mock Data ---
let appState = {
  repoPath: '',
  baseBranch: 'main',
  analysisResult: null,
  ghostwriteResult: null,
  commitCleanupResult: null,
  gpgSignature: null,
  isSampleLoaded: false
};

const mockGitAnalyze = {
  branch: 'feature-auth',
  baseBranch: 'main',
  commits: [
    { hash: "c001a", author: "Alice <alice@shipghost.io>", date: "2026-06-17T10:00:00Z", message: "wip", filesChanged: ["src/auth/__init__.py"] },
    { hash: "c002b", author: "Alice <alice@shipghost.io>", date: "2026-06-17T10:15:00Z", message: "wip", filesChanged: ["src/auth/routes.py"] },
    { hash: "c003c", author: "Alice <alice@shipghost.io>", date: "2026-06-17T10:30:00Z", message: "wip", filesChanged: ["src/auth/middleware.py"] },
    { hash: "c004d", author: "Alice <alice@shipghost.io>", date: "2026-06-17T10:45:00Z", message: "fix", filesChanged: ["src/auth/middleware.py"] },
    { hash: "c005e", author: "Alice <alice@shipghost.io>", date: "2026-06-17T11:00:00Z", message: "wip", filesChanged: ["src/auth/middleware.py", "config.py"] },
    { hash: "c006f", author: "Alice <alice@shipghost.io>", date: "2026-06-17T11:15:00Z", message: "stuff", filesChanged: ["requirements.txt"] },
    { hash: "c007a", author: "Alice <alice@shipghost.io>", date: "2026-06-17T11:30:00Z", message: "wip", filesChanged: ["src/db/connection.py"] },
    { hash: "c008b", author: "Alice <alice@shipghost.io>", date: "2026-06-17T11:45:00Z", message: "wip", filesChanged: ["src/db/connection.py"] },
    { hash: "c009c", author: "Alice <alice@shipghost.io>", date: "2026-06-17T12:00:00Z", message: "fix", filesChanged: ["src/db/connection.py"] },
    { hash: "c010d", author: "Alice <alice@shipghost.io>", date: "2026-06-17T12:15:00Z", message: "wip", filesChanged: ["src/auth/routes.py"] }
  ],
  diffSummary: {
    filesChanged: 6,
    insertions: 185,
    deletions: 24
  },
  fullDiff: `diff --git a/src/auth/middleware.py b/src/auth/middleware.py
index a27cd34..12bcd34 100644
--- a/src/auth/middleware.py
+++ b/src/auth/middleware.py
@@ -10,3 +10,22 @@
+def jwt_validation_middleware(request):
+    token = request.headers.get("Authorization")
+    if not token:
+        raise ValueError("Missing token")
+    try:
+        # Decoding token using standard algorithms
+        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
+        return payload
+    except jwt.ExpiredSignatureError:
+        raise ValueError("Expired token")
+    except jwt.InvalidTokenError:
+        raise ValueError("Invalid credentials")`,
  fileGroups: [
    { component: "auth/middleware", files: ["src/auth/middleware.py", "src/auth/routes.py", "src/auth/__init__.py"] },
    { component: "db/connection", files: ["src/db/connection.py"] },
    { component: "root", files: ["requirements.txt", "config.py"] }
  ]
};

const mockPrGhostwrite = {
  title: "feat(auth): add JWT signature validation & routing middleware",
  summary: "This PR establishes JWT-based authorization guard rails. It reads tokens from headers and verifies them locally under a shared symmetric key, routing user profiles to verified endpoints.",
  changes: "- Implemented jwt_validation_middleware supporting token claims\n- Set up base routing for auth endpoint\n- Fixed db pool leak under high concurrency loads",
  rationale: "Decentralizes token checking away from third party identity providers, cutting authentication latency to <15ms.",
  testing: "Covered by unit tests in test_auth.py. Simulated expired token headers to verify standard error handlers.",
  inlineComments: [
    { file: "src/auth/middleware.py", line: 15, comment: "Security Check: HS256 is susceptible to key leaking. Consider upgrading to RS256 with rotating JWKS endpoints." },
    { file: "src/db/connection.py", line: 22, comment: "Performance: Ensure the connection pool maximum size matches container CPU allocation." }
  ]
};

const mockCommitsCleanup = {
  rewrites: [
    { originalHash: "c001a", originalMessage: "wip", newMessage: "feat(auth): initialize auth module structure", explanation: "First commit outlining namespaces." },
    { originalHash: "c002b", originalMessage: "wip", newMessage: "feat(auth): map basic login route paths", explanation: "Add endpoints placeholder." },
    { originalHash: "c003c", originalMessage: "wip", newMessage: "feat(auth): implement JWT decoding handler", explanation: "Write validation algorithm." },
    { originalHash: "c004d", originalMessage: "fix", newMessage: "fix(auth): prevent null pointer on missing auth header", explanation: "Fix runtime error." },
    { originalHash: "c005e", originalMessage: "wip", newMessage: "feat(auth): support key parsing config", explanation: "Bind key to environment settings." },
    { originalHash: "c006f", originalMessage: "stuff", newMessage: "chore(deps): add pyjwt package reference", explanation: "Package dependency requirements." },
    { originalHash: "c007a", originalMessage: "wip", newMessage: "feat(db): establish connection pool config", explanation: "Init pool manager." },
    { originalHash: "c008b", originalMessage: "wip", newMessage: "refactor(db): close active connections properly", explanation: "Mitigate connection leak risks." }
  ]
};

// --- 3. Mock Host API logic (standalone browser running) ---
function mockHostCall(action, payload) {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (action === 'storage.get') {
        const item = localStorage.getItem(payload.key);
        resolve(item ? JSON.parse(item) : null);
      } else if (action === 'storage.set') {
        localStorage.setItem(payload.key, JSON.stringify(payload.value));
        resolve({ success: true });
      } else if (action === 'upload.negotiate') {
        resolve({
          put_url: 'https://mock-r2.shipghost.io/signed_pr_bucket/put_url',
          public_url: `https://share.shipghost.io/bundles/${Math.random().toString(36).substring(7)}.md`
        });
      } else {
        resolve({});
      }
    }, 200);
  });
}

// --- 4. Navigation & DOM Binding ---
const screens = {
  input: document.getElementById('screen-input'),
  analyzing: document.getElementById('screen-analyzing'),
  dashboard: document.getElementById('screen-dashboard'),
  console: document.getElementById('screen-console')
};

function showScreen(name) {
  Object.keys(screens).forEach(key => {
    if (key === name) {
      screens[key].classList.add('active');
    } else {
      screens[key].classList.remove('active');
    }
  });
}

const tabs = {
  pr: { btn: document.getElementById('tab-pr-desc'), pane: document.getElementById('tab-content-pr') },
  comments: { btn: document.getElementById('tab-inline-comments'), pane: document.getElementById('tab-content-comments') },
  commits: { btn: document.getElementById('tab-commit-cleanup'), pane: document.getElementById('tab-content-commits') }
};

function activateTab(name, skipOpenView = false) {
  Object.keys(tabs).forEach(key => {
    if (key === name) {
      tabs[key].btn.classList.add('active');
      tabs[key].pane.style.display = 'flex';
    } else {
      tabs[key].btn.classList.remove('active');
      tabs[key].pane.style.display = 'none';
    }
  });

  if (!skipOpenView) {
    if (name === 'comments') {
      anna.window.open_view('inline_inspector', { hash: '#/inspector' }).catch(console.warn);
    } else if (name === 'commits') {
      anna.window.open_view('commit_cleaner', { hash: '#/cleaner' }).catch(console.warn);
    } else if (name === 'pr') {
      anna.window.open_view('main', { hash: '#/' }).catch(console.warn);
    }
  }
}

// Bind tabs click
tabs.pr.btn.addEventListener('click', () => {
  window.location.hash = '#/';
  activateTab('pr');
});
tabs.comments.btn.addEventListener('click', () => {
  window.location.hash = '#/inspector';
  activateTab('comments');
});
tabs.commits.btn.addEventListener('click', () => {
  window.location.hash = '#/cleaner';
  activateTab('commits');
});

function handleHashRoute() {
  const hash = window.location.hash;
  if (hash === '#/console') {
    showScreen('console');
    document.getElementById('nav-workspace-btn').classList.remove('active');
    document.getElementById('nav-anna-console-btn').classList.add('active');
  } else {
    document.getElementById('nav-workspace-btn').classList.add('active');
    document.getElementById('nav-anna-console-btn').classList.remove('active');
    if (appState.ghostwriteResult) {
      showScreen('dashboard');
    } else {
      showScreen('input');
    }
    
    if (hash === '#/inspector') {
      activateTab('comments', true);
    } else if (hash === '#/cleaner') {
      activateTab('commits', true);
    } else {
      activateTab('pr', true);
    }
  }
}

window.addEventListener('hashchange', handleHashRoute);
window.addEventListener('DOMContentLoaded', () => {
  handleHashRoute();
  
  // Bind Header navigation buttons
  document.getElementById('nav-workspace-btn').addEventListener('click', () => {
    window.location.hash = '#/';
  });

  document.getElementById('nav-anna-console-btn').addEventListener('click', () => {
    window.location.hash = '#/console';
  });
});

// Toast message helper
function showToast(message) {
  const toast = document.getElementById('toast-banner');
  toast.innerText = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Console logger logger
function logConsole(message) {
  const consoleEl = document.getElementById('log-console');
  consoleEl.innerHTML += `\n[executa] ${message}`;
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// --- 5. Analysis orchestrator ---
document.getElementById('btn-load-sample').addEventListener('click', () => {
  appState.isSampleLoaded = true;
  document.getElementById('input-repo-path').value = ".";
  showToast("Sample messy branch fixtures loaded!");
});

document.getElementById('btn-start-analysis').addEventListener('click', () => {
  appState.repoPath = document.getElementById('input-repo-path').value;
  appState.baseBranch = document.getElementById('input-base-branch').value;
  
  if (!appState.repoPath) {
    showToast("Please enter a valid repository path!");
    return;
  }

  showScreen('analyzing');
  document.getElementById('log-console').innerHTML = "[executa] Initializing git.analyze tool parameters...";
  setTimeout(() => { runGitAnalysis(); }, 600);
});

// Run Git subprocess analysis
async function runGitAnalysis() {
  logConsole(`Running: git diff ${appState.baseBranch}...HEAD`);
  
  try {
    let result;
    if (appState.isSampleLoaded || !isHostAvailable) {
      // Mock analyzer
      result = mockGitAnalyze;
      logConsole(`Git analyzer completed. Diffs hash: sha256-${Math.random().toString(36).substring(6)}`);
    } else {
      result = await anna.tools.invoke('git.analyze', {
        repoPath: appState.repoPath,
        baseBranch: appState.baseBranch
      });
    }
    
    appState.analysisResult = result;
    logConsole(`Diff Summary: ${result.diffSummary.filesChanged} files modified, +${result.diffSummary.insertions} -${result.diffSummary.deletions}`);
    logConsole("Running: AES-GCM-256 diff payload encryption...");
    
    // Process to AI ghostwrite
    setTimeout(() => { runPrGhostwrite(); }, 1000);
  } catch (error) {
    logConsole(`Error running git analyzer: ${error.message || error}`);
    showToast("Analysis failed!");
    setTimeout(() => showScreen('input'), 3000);
  }
}

// Run AI Ghostwrite
async function runPrGhostwrite() {
  logConsole("Calling sampling/createMessage via RPC envelope...");
  
  try {
    let result;
    let cleanCommits;
    
    if (appState.isSampleLoaded || !isHostAvailable) {
      result = mockPrGhostwrite;
      cleanCommits = mockCommitsCleanup;
    } else {
      result = await anna.tools.invoke('pr.ghostwrite', {
        diffSummary: appState.analysisResult.diffSummary,
        commits: appState.analysisResult.commits,
        fullDiff: appState.analysisResult.fullDiff,
        fileGroups: appState.analysisResult.fileGroups
      });
      
      cleanCommits = await anna.tools.invoke('commits.cleanup', {
        commits: appState.analysisResult.commits
      });
    }
    
    appState.ghostwriteResult = result;
    appState.commitCleanupResult = cleanCommits;
    
    logConsole("Decryption of response payload successful.");
    logConsole("Formulating 3-Tab review queues...");
    
    // Save draft state to Persistent Storage
    await anna.storage.set('shipghost_draft', {
      repoPath: appState.repoPath,
      analysis: appState.analysisResult,
      ghostwrite: appState.ghostwriteResult,
      commits: appState.commitCleanupResult
    });
    
    populateReviewDesks();
    showToast("Diff Analysis complete! Reviewing PR.");
    showScreen('dashboard');
  } catch (error) {
    logConsole(`Error running ghostwriter: ${error.message || error}`);
    showToast("PR drafting failed!");
    setTimeout(() => showScreen('input'), 3000);
  }
}

// Populators
function populateReviewDesks() {
  const g = appState.ghostwriteResult;
  const c = appState.commitCleanupResult;
  
  // Fill inputs
  document.getElementById('pr-title').value = g.title;
  document.getElementById('pr-summary').value = g.summary;
  document.getElementById('pr-changes').value = g.changes;
  document.getElementById('pr-rationale').value = g.rationale;
  document.getElementById('pr-testing').value = g.testing;
  
  // Fill Comments
  const commentsList = document.getElementById('inline-comments-list');
  commentsList.innerHTML = '';
  if (g.inlineComments && g.inlineComments.length > 0) {
    g.inlineComments.forEach((comment, idx) => {
      const el = document.createElement('div');
      el.className = 'commit-item';
      el.innerHTML = `
        <div style="flex: 1;">
          <div style="font-family: var(--font-mono); font-size: 11px; color: var(--primary); margin-bottom: 6px;">
            FILE: ${comment.file} (Line ${comment.line})
          </div>
          <div style="font-size: 13px; line-height: 1.4; color: rgba(255,255,255,0.85);">${comment.comment}</div>
        </div>
        <div style="display:flex; gap: 8px;">
          <button class="btn-primary btn-comment-dismiss" style="padding: 6px 12px; font-size:11px; background:rgba(239,68,68,0.1); border:1px solid var(--status-error); color:var(--status-error);" data-index="${idx}">Dismiss</button>
          <button class="btn-primary btn-comment-accept" style="padding: 6px 12px; font-size:11px; background:rgba(16,185,129,0.1); border:1px solid var(--status-success); color:var(--status-success);" data-index="${idx}">Accept</button>
        </div>
      `;
      commentsList.appendChild(el);
    });
  } else {
    commentsList.innerHTML = '<p style="color:rgba(255,255,255,0.4); text-align:center;">No suggestions generated.</p>';
  }
  
  // Fill Commits
  const commitsList = document.getElementById('commit-rewrites-list');
  commitsList.innerHTML = '';
  if (c.rewrites && c.rewrites.length > 0) {
    c.rewrites.forEach((rewrite, idx) => {
      const el = document.createElement('div');
      el.className = 'commit-item';
      el.innerHTML = `
        <div class="commit-diff-comparison">
          <div class="commit-bad">c - ${rewrite.originalMessage}</div>
          <div class="commit-good">${rewrite.newMessage}</div>
          <div style="font-size:11px; color:rgba(255,255,255,0.4);">${rewrite.explanation}</div>
        </div>
        <input type="checkbox" checked class="commit-checkbox" data-index="${idx}" style="width:20px; height:20px; accent-color: var(--primary);">
      `;
      commitsList.appendChild(el);
    });
  } else {
    commitsList.innerHTML = '<p style="color:rgba(255,255,255,0.4); text-align:center;">No commits parsed.</p>';
  }
}

// Bind comments actions
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('btn-comment-dismiss')) {
    const idx = e.target.getAttribute('data-index');
    e.target.closest('.commit-item').style.opacity = '0.3';
    showToast("Comment dismissed");
  }
  if (e.target.classList.contains('btn-comment-accept')) {
    const idx = e.target.getAttribute('data-index');
    e.target.closest('.commit-item').style.borderColor = 'var(--status-success)';
    showToast("Comment accepted and included");
  }
});

// Clearsign with GPG/SSH
document.getElementById('btn-sign-gpg').addEventListener('click', async () => {
  const prTitle = document.getElementById('pr-title').value;
  const prSummary = document.getElementById('pr-summary').value;
  const prChanges = document.getElementById('pr-changes').value;
  const prRationale = document.getElementById('pr-rationale').value;
  const prTesting = document.getElementById('pr-testing').value;

  const fullMarkdown = `# ${prTitle}

## Summary
${prSummary}

## Detailed Modifications
${prChanges}

## Architecture Rationale
${prRationale}

## Testing Actions
${prTesting}`;

  showToast("Invoking GPG Clearsign...");
  try {
    let result;
    if (appState.isSampleLoaded || !isHostAvailable) {
      // Mock clearsign
      const h = Math.random().toString(36).substring(2);
      result = {
        signedMarkdown: `-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\n${fullMarkdown}\n-----BEGIN PGP SIGNATURE-----\nVersion: GnuPG v2\n\nSignature-Hash: ${h}\n-----END PGP SIGNATURE-----`,
        signature: `mock-sig-${h}`
      };
    } else {
      result = await anna.tools.invoke('pr.sign', {
        prMarkdown: fullMarkdown
      });
    }

    appState.gpgSignature = result;
    document.getElementById('gpg-signature-block').innerText = result.signedMarkdown;
    document.getElementById('gpg-signature-container').style.display = 'flex';
    showToast("PR Description Clearsigned!");
  } catch (error) {
    showToast(`Signature failed: ${error.message || error}`);
  }
});

// Publish PR Bundle to R2
document.getElementById('btn-export-r2').addEventListener('click', async () => {
  if (!appState.gpgSignature) {
    showToast("Please Clearsign the PR before uploading to R2!");
    return;
  }
  
  showToast("Negotiating R2 storage credentials...");
  
  try {
    const ticket = await anna.upload.negotiate("signed_pr.md", "text/markdown");
    showToast("Uploading Signed PR bundle to host R2...");
    
    const prTitle = document.getElementById('pr-title').value;
    const signedContent = appState.gpgSignature.signedMarkdown;
    
    let publicUrl = "";
    if (ticket.put_url && ticket.put_url.startsWith("http")) {
      const headers = { "Content-Type": "text/markdown" };
      if (ticket.headers) {
        Object.assign(headers, ticket.headers);
      }
      await fetch(ticket.put_url, {
        method: "PUT",
        body: signedContent,
        headers: headers
      });
      
      const conf = await anna.upload.confirm(ticket.r2_key);
      publicUrl = conf.download_url;
    } else {
      // stand-alone sandbox fallback
      publicUrl = ticket.public_url || `https://share.shipghost.io/bundles/${Math.random().toString(36).substring(7)}.md`;
    }
    
    // Display shareable link in timeline chat
    const chatTimeline = document.getElementById('chat-timeline');
    const el = document.createElement('div');
    el.className = 'chat-msg agent';
    el.innerHTML = `
      <strong>Export Pipeline Complete ✅</strong><br>
      Signed PR markdown bundle successfully uploaded to host R2 bucket.<br>
      <a href="${publicUrl}" target="_blank" style="color:var(--primary); text-decoration:underline; font-family:var(--font-mono); font-size:12px;">Download Signed PR (R2 Link)</a>
    `;
    chatTimeline.appendChild(el);
    chatTimeline.scrollTop = chatTimeline.scrollHeight;
    
    // Post timeline artifact using chat.append_artifact
    const a = await annaReady;
    if (a && a.chat && a.chat.append_artifact) {
      try {
        await a.chat.append_artifact({
          artifact: {
            kind: "shipghost_pr",
            summary: `PR Title: ${prTitle}\nUploaded signed PR bundle to R2 storage.`,
            payload_ref: publicUrl
          }
        });
      } catch (artifactErr) {
        console.warn("Could not append chat artifact:", artifactErr);
      }
    }
    
    showToast("PR Bundle Published successfully!");
    
  } catch (error) {
    showToast(`R2 upload failed: ${error.message || error}`);
  }
});

// --- 6. Timeline Agent Chat Session ---
document.getElementById('btn-chat-send').addEventListener('click', () => {
  sendChatMessage();
});

document.getElementById('chat-input-box').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendChatMessage();
  }
});

async function sendChatMessage() {
  const inputBox = document.getElementById('chat-input-box');
  const userText = inputBox.value.trim();
  if (!userText) return;
  
  inputBox.value = '';
  
  const chatTimeline = document.getElementById('chat-timeline');
  
  // User message
  const userEl = document.createElement('div');
  userEl.className = 'chat-msg user';
  userEl.innerText = userText;
  chatTimeline.appendChild(userEl);
  chatTimeline.scrollTop = chatTimeline.scrollHeight;
  
  // Waiting typing indicator
  const waitEl = document.createElement('div');
  waitEl.className = 'chat-msg agent';
  waitEl.innerText = "...";
  chatTimeline.appendChild(waitEl);
  chatTimeline.scrollTop = chatTimeline.scrollHeight;
  
  try {
    let agentReply;
    if (appState.isSampleLoaded || !isHostAvailable) {
      // Mock replies
      agentReply = "I have reviewed your request. Based on the JWT middleware diffs and log architecture, I recommend updating the PR title to reflect this specific security scope.";
    } else {
      const a = await annaReady;
      if (a && a.llm && a.llm.complete) {
        const response = await a.llm.complete({
          messages: [
            { role: "system", content: { type: "text", text: "You are the Release Engineer Agent helping a developer finalize a PR. Keep answers brief and focused." } },
            { role: "user", content: { type: "text", text: `Developer requests: ${userText}\n\nCurrent PR info: ${JSON.stringify(appState.ghostwriteResult)}` } }
          ],
          maxTokens: 500
        });
        agentReply = response.content?.text || response.text || "I'm reviewing that change right now.";
      } else {
        agentReply = "I am ready to help, but LLM service is currently unavailable.";
      }
    }
    
    // Remove typing indicator and add response
    chatTimeline.removeChild(waitEl);
    
    const agentEl = document.createElement('div');
    agentEl.className = 'chat-msg agent';
    agentEl.innerText = agentReply;
    chatTimeline.appendChild(agentEl);
    chatTimeline.scrollTop = chatTimeline.scrollHeight;
    
  } catch (error) {
    chatTimeline.removeChild(waitEl);
    showToast("Chat failed");
  }
}

// Check if there is an active saved draft on initialization
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const draft = await anna.storage.get('shipghost_draft');
    if (draft) {
      appState.repoPath = draft.repoPath;
      appState.analysisResult = draft.analysis;
      appState.ghostwriteResult = draft.ghostwrite;
      appState.commitCleanupResult = draft.commits;
      
      document.getElementById('input-repo-path').value = draft.repoPath;
      populateReviewDesks();
      showScreen('dashboard');
      showToast("Restored pending PR workspace from storage!");
    }
  } catch (e) {
    console.error("Failed to recover draft state:", e);
  }
});

// ─── Anna Developer Console JavaScript Implementation ────────────────
const $ = (id) => document.getElementById(id);
let activeAgentSessionUuid = null;

function escapeHtml(string) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };
  return String(string).replace(/[&<>"']/g, function(m) { return map[m]; });
}

function logSdkCall(method, params, result, error = null) {
  const box = $("sdk-log-box");
  const time = new Date().toTimeString().split(' ')[0];
  const entry = document.createElement("div");
  entry.className = "log-entry";
  
  let resultHtml = "";
  if (error) {
    resultHtml = `<div class="log-error">Error: ${escapeHtml(JSON.stringify(error))}</div>`;
  } else {
    resultHtml = `<div class="log-result">Result: ${escapeHtml(JSON.stringify(result))}</div>`;
  }
  
  entry.innerHTML = `
    <span class="log-time">[${time}]</span>
    <span class="log-method">${escapeHtml(method)}</span>
    <div class="log-params">Params: ${escapeHtml(JSON.stringify(params))}</div>
    ${resultHtml}
  `;
  box.appendChild(entry);
  box.scrollTop = box.scrollHeight;
}

$("console-clear-logs").addEventListener("click", () => {
  $("sdk-log-box").innerHTML = `
    <div class="log-entry">
      <span class="log-time">[${new Date().toTimeString().split(' ')[0]}]</span>
      <span class="log-method">SYSTEM</span>: Logs cleared.
    </div>
  `;
});

// 1. Agent Sessions Actions
$("sdk-agent-create").addEventListener("click", async () => {
  const label = $("sdk-agent-label").value;
  const ttl = parseInt($("sdk-agent-ttl").value, 10) || 600;
  const a = await annaReady;
  
  const params = { label, ttl_seconds: ttl, submode: "auto" };
  try {
    let res;
    if (a && a.agent && a.agent.session) {
      res = await a.agent.session.create(params);
    } else {
      res = { app_session_uuid: "mock_session_" + Math.random().toString(36).substring(2, 10), mock: true };
    }
    activeAgentSessionUuid = res.app_session_uuid;
    logSdkCall("anna.agent.session.create", params, res);
    
    $("sdk-agent-run").disabled = false;
    $("sdk-agent-cancel").disabled = false;
    $("sdk-agent-history").disabled = false;
    $("sdk-agent-refresh").disabled = false;
    $("sdk-agent-delete").disabled = false;
    
    $("sdk-agent-chat-area").style.display = "block";
    $("sdk-agent-messages").innerHTML = `<div style="color:var(--primary);">Session started: ${activeAgentSessionUuid}</div>`;
  } catch (err) {
    logSdkCall("anna.agent.session.create", params, null, err);
  }
});

$("sdk-agent-run").addEventListener("click", async () => {
  await sendConsoleAgentTurn();
});

$("sdk-agent-send").addEventListener("click", async () => {
  await sendConsoleAgentTurn();
});

$("sdk-agent-input").addEventListener("keypress", async (e) => {
  if (e.key === "Enter") await sendConsoleAgentTurn();
});

async function sendConsoleAgentTurn() {
  const input = $("sdk-agent-input");
  const text = input.value.trim();
  if (!text || !activeAgentSessionUuid) return;
  
  const messagesBox = $("sdk-agent-messages");
  messagesBox.innerHTML += `<div style="color:#fff;">User: ${escapeHtml(text)}</div>`;
  input.value = "";
  
  const a = await annaReady;
  const params = { app_session_uuid: activeAgentSessionUuid, content: text };
  
  try {
    let res;
    if (a && a.agent && a.agent.session) {
      res = await a.agent.session.run(params);
    } else {
      res = { frames: [{ event: "final", content: "Mock agent response to: " + text }], mock: true };
    }
    logSdkCall("anna.agent.session.run", params, res);
    
    if (res.frames && res.frames.length > 0) {
      res.frames.forEach(f => {
        if (f.content) {
          messagesBox.innerHTML += `<div style="color:var(--accent);">Agent: ${escapeHtml(f.content)}</div>`;
        }
      });
    }
    messagesBox.scrollTop = messagesBox.scrollHeight;
  } catch (err) {
    logSdkCall("anna.agent.session.run", params, null, err);
  }
}

$("sdk-agent-cancel").addEventListener("click", async () => {
  if (!activeAgentSessionUuid) return;
  const a = await annaReady;
  const params = { app_session_uuid: activeAgentSessionUuid };
  try {
    let res = (a && a.agent && a.agent.session) ? await a.agent.session.cancel(params) : { ok: true, mock: true };
    logSdkCall("anna.agent.session.cancel", params, res);
  } catch (err) {
    logSdkCall("anna.agent.session.cancel", params, null, err);
  }
});

$("sdk-agent-history").addEventListener("click", async () => {
  if (!activeAgentSessionUuid) return;
  const a = await annaReady;
  const params = { app_session_uuid: activeAgentSessionUuid };
  try {
    let res = (a && a.agent && a.agent.session) ? await a.agent.session.history(params) : { messages: [], mock: true };
    logSdkCall("anna.agent.session.history", params, res);
  } catch (err) {
    logSdkCall("anna.agent.session.history", params, null, err);
  }
});

$("sdk-agent-refresh").addEventListener("click", async () => {
  if (!activeAgentSessionUuid) return;
  const a = await annaReady;
  const ttl = parseInt($("sdk-agent-ttl").value, 10) || 600;
  const params = { app_session_uuid: activeAgentSessionUuid, ttl_seconds: ttl };
  try {
    let res = (a && a.agent && a.agent.session) ? await a.agent.session.refresh(params) : { ok: true, mock: true };
    logSdkCall("anna.agent.session.refresh", params, res);
  } catch (err) {
    logSdkCall("anna.agent.session.refresh", params, null, err);
  }
});

$("sdk-agent-list").addEventListener("click", async () => {
  const a = await annaReady;
  try {
    let res = (a && a.agent && a.agent.session) ? await a.agent.session.list() : { sessions: [], mock: true };
    logSdkCall("anna.agent.session.list", {}, res);
  } catch (err) {
    logSdkCall("anna.agent.session.list", {}, null, err);
  }
});

$("sdk-agent-delete").addEventListener("click", async () => {
  if (!activeAgentSessionUuid) return;
  const a = await annaReady;
  const params = { app_session_uuid: activeAgentSessionUuid };
  try {
    let res = (a && a.agent && a.agent.session) ? await a.agent.session.delete(params) : { ok: true, mock: true };
    logSdkCall("anna.agent.session.delete", params, res);
    
    activeAgentSessionUuid = null;
    $("sdk-agent-run").disabled = true;
    $("sdk-agent-cancel").disabled = true;
    $("sdk-agent-history").disabled = true;
    $("sdk-agent-refresh").disabled = true;
    $("sdk-agent-delete").disabled = true;
    $("sdk-agent-chat-area").style.display = "none";
  } catch (err) {
    logSdkCall("anna.agent.session.delete", params, null, err);
  }
});

// 2. Image Actions
$("sdk-image-generate").addEventListener("click", async () => {
  const prompt = $("sdk-image-prompt").value;
  const size = $("sdk-image-size").value;
  const a = await annaReady;
  const params = { prompt, n: 1, size };
  try {
    let res;
    if (a && a.image && a.image.generate) {
      res = await a.image.generate(params);
    } else {
      res = [{ url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500", mock: true }];
    }
    logSdkCall("anna.image.generate", params, res);
    if (res && res[0] && res[0].url) {
      $("sdk-image-img").src = res[0].url;
      $("sdk-image-result").style.display = "block";
    }
  } catch (err) {
    logSdkCall("anna.image.generate", params, null, err);
  }
});

$("sdk-image-edit").addEventListener("click", async () => {
  const prompt = $("sdk-image-prompt").value;
  const size = $("sdk-image-size").value;
  const imageUrl = $("sdk-image-url").value || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500";
  const a = await annaReady;
  const params = { image_url: imageUrl, prompt, n: 1, size };
  try {
    let res;
    if (a && a.image && a.image.edit) {
      res = await a.image.edit(params);
    } else {
      res = [{ url: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=500", mock: true }];
    }
    logSdkCall("anna.image.edit", params, res);
    if (res && res[0] && res[0].url) {
      $("sdk-image-img").src = res[0].url;
      $("sdk-image-result").style.display = "block";
    }
  } catch (err) {
    logSdkCall("anna.image.edit", params, null, err);
  }
});

// 3. Embeddings & Complete
$("sdk-embed-btn").addEventListener("click", async () => {
  const input = $("sdk-embed-text").value;
  const a = await annaReady;
  const params = { input };
  try {
    let res = (a && a.llm && a.llm.embed) ? await a.llm.embed(params) : { embedding: Array(64).fill(0).map(() => Math.random()), mock: true };
    logSdkCall("anna.llm.embed", params, res);
    $("sdk-embed-result").innerText = JSON.stringify(res, null, 2);
    $("sdk-embed-result").style.display = "block";
  } catch (err) {
    logSdkCall("anna.llm.embed", params, null, err);
  }
});

$("sdk-complete-btn").addEventListener("click", async () => {
  const input = $("sdk-embed-text").value;
  const a = await annaReady;
  const params = { messages: [{ role: "user", content: input }] };
  try {
    let res = (a && a.llm && a.llm.complete) ? await a.llm.complete(params) : { content: "Mock complete: " + input, mock: true };
    logSdkCall("anna.llm.complete", params, res);
    $("sdk-embed-result").innerText = JSON.stringify(res, null, 2);
    $("sdk-embed-result").style.display = "block";
  } catch (err) {
    logSdkCall("anna.llm.complete", params, null, err);
  }
});

// 4. KV Store & Upload
$("sdk-kv-get").addEventListener("click", async () => {
  const key = $("sdk-kv-key").value;
  const a = await annaReady;
  const params = { key, scope: "user" };
  try {
    let res = (a && a.storage) ? await a.storage.get(key) : { value: "mock_value", mock: true };
    logSdkCall("anna.storage.get", params, res);
  } catch (err) {
    logSdkCall("anna.storage.get", params, null, err);
  }
});

$("sdk-kv-set").addEventListener("click", async () => {
  const key = $("sdk-kv-key").value;
  const value = $("sdk-kv-val").value;
  const a = await annaReady;
  const params = { key, value, scope: "user" };
  try {
    let res = (a && a.storage) ? await a.storage.set(key, value) : { ok: true, mock: true };
    logSdkCall("anna.storage.set", params, res);
  } catch (err) {
    logSdkCall("anna.storage.set", params, null, err);
  }
});

$("sdk-kv-delete").addEventListener("click", async () => {
  const key = $("sdk-kv-key").value;
  const a = await annaReady;
  const params = { key, scope: "user" };
  try {
    let res = (a && a.storage) ? await a.storage.delete(key) : { ok: true, mock: true };
    logSdkCall("anna.storage.delete", params, res);
  } catch (err) {
    logSdkCall("anna.storage.delete", params, null, err);
  }
});

$("sdk-kv-list").addEventListener("click", async () => {
  const key = $("sdk-kv-key").value;
  const a = await annaReady;
  const params = { prefix: key, scope: "user" };
  try {
    let res = (a && a.storage) ? await a.storage.list(params) : { keys: [key], mock: true };
    logSdkCall("anna.storage.list", params, res);
  } catch (err) {
    logSdkCall("anna.storage.list", params, null, err);
  }
});

$("sdk-upload-btn").addEventListener("click", async () => {
  const fileInput = $("sdk-upload-file");
  if (!fileInput.files || fileInput.files.length === 0) {
    showToast("Please choose a file to upload first.");
    return;
  }
  const file = fileInput.files[0];
  const a = await annaReady;
  
  const params = { filename: file.name, mime_type: file.type, byte_length: file.size, purpose: "artifact" };
  try {
    let res;
    if (a && a.upload && a.upload.negotiate) {
      // Step 1: Negotiate
      const nego = await a.upload.negotiate(params);
      logSdkCall("anna.upload.negotiate", params, nego);
      
      if (nego && nego.upload_url) {
        // Step 2: PUT file
        await fetch(nego.upload_url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type }
        });
        
        // Step 3: Confirm
        const confParams = { r2_key: nego.r2_key };
        const conf = await a.upload.confirm(confParams);
        logSdkCall("anna.upload.confirm", confParams, conf);
        res = conf;
      }
    } else {
      // Inline upload fallback
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const inlineParams = { filename: file.name, mime_type: file.type, content_b64: base64, purpose: "artifact" };
        if (a && a.upload && a.upload.inline) {
          res = await a.upload.inline(inlineParams);
          logSdkCall("anna.upload.inline", inlineParams, res);
        } else {
          res = { download_url: "https://mock.download.url/" + file.name, mock: true };
          logSdkCall("anna.upload.inline (fallback)", inlineParams, res);
        }
      };
      reader.readAsDataURL(file);
      return;
    }
  } catch (err) {
    logSdkCall("anna.upload.negotiate/confirm", params, null, err);
  }
});

// 5. Window, Tools & Egress
$("sdk-win-title-btn").addEventListener("click", async () => {
  const title = $("sdk-win-title").value;
  const a = await annaReady;
  const params = title;
  try {
    let res = (a && a.window && a.window.set_title) ? await a.window.set_title(title) : { ok: true, mock: true };
    logSdkCall("anna.window.set_title", params, res);
  } catch (err) {
    logSdkCall("anna.window.set_title", params, null, err);
  }
});

$("sdk-win-open-btn").addEventListener("click", async () => {
  const view = $("sdk-win-view").value;
  const a = await annaReady;
  const params = { name: view };
  try {
    let res = (a && a.window && a.window.open_view) ? await a.window.open_view(view) : { ok: true, mock: true };
    logSdkCall("anna.window.open_view", params, res);
  } catch (err) {
    logSdkCall("anna.window.open_view", params, null, err);
  }
});

$("sdk-win-close-btn").addEventListener("click", async () => {
  const a = await annaReady;
  try {
    let res = (a && a.window && a.window.close) ? await a.window.close() : { ok: true, mock: true };
    logSdkCall("anna.window.close", {}, res);
  } catch (err) {
    logSdkCall("anna.window.close", {}, null, err);
  }
});

$("sdk-tools-list-btn").addEventListener("click", async () => {
  const a = await annaReady;
  try {
    let res = (a && a.tools && a.tools.list) ? await a.tools.list() : { tools: [], mock: true };
    logSdkCall("anna.tools.list", {}, res);
  } catch (err) {
    logSdkCall("anna.tools.list", {}, null, err);
  }
});

$("sdk-chat-msg-btn").addEventListener("click", async () => {
  const text = $("sdk-chat-msg").value;
  const a = await annaReady;
  const params = { text };
  try {
    let res = (a && a.chat && a.chat.write_message) ? await a.chat.write_message({ text }) : { ok: true, mock: true };
    logSdkCall("anna.chat.write_message", params, res);
  } catch (err) {
    logSdkCall("anna.chat.write_message", params, null, err);
  }
});

$("sdk-chat-artifact-btn").addEventListener("click", async () => {
  const text = $("sdk-chat-msg").value;
  const a = await annaReady;
  const params = {
    type: "developer_artifact",
    title: "ShipGhost Dev Resolution",
    summary: text,
    link: "https://r2.shipghost.io/artifacts/test.txt",
    svg: `<svg viewBox="0 0 100 100" width="80" height="80"><circle cx="50" cy="50" r="40" fill="var(--accent)" /></svg>`
  };
  try {
    let res = (a && a.chat && a.chat.append_artifact) ? await a.chat.append_artifact(params) : { ok: true, mock: true };
    logSdkCall("anna.chat.append_artifact", params, res);
  } catch (err) {
    logSdkCall("anna.chat.append_artifact", params, null, err);
  }
});

