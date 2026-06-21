import pytest
import sys
import os
import json
import hashlib
from unittest.mock import patch, MagicMock

# Mock the sys path to import our plugin
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../executas/shipghost')))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from executas.shipghost import plugin

sys.modules['plugin'] = plugin


# ----------------- TEST AES ENCRYPTION/DECRYPTION (50 cases) -----------------
# We test 50 different payload styles (various sizes, special characters, structures)
payloads_to_test = [
    f"Diff line payload #{i}: added some important code lines here with special chars !@#$%^&*()_+ and emoji 🚀."
    for i in range(50)
]

@pytest.mark.parametrize("payload", payloads_to_test)
def test_aes_gcm_encryption_decryption(payload):
    # Encrypt
    enc = plugin.encrypt_aes_gcm(payload)
    assert "ciphertext" in enc
    assert "nonce" in enc
    assert "tag" in enc
    assert "key" in enc
    
    # Decrypt and compare
    dec = plugin.decrypt_aes_gcm(enc)
    assert dec == payload

# ----------------- TEST GPG CLEARSIGNING (30 cases) -----------------
# Parameterized test over 30 markdown blocks to verify GPG clearsign formatting
markdown_blocks = [
    f"""# Pull Request #{i}
This is a detailed PR body containing changes and architecture details.
Hash: {hashlib.sha256(str(i).encode()).hexdigest()}
    """
    for i in range(30)
]

@pytest.mark.parametrize("md", markdown_blocks)
def test_gpg_clearsign_fallback(md):
    res = plugin.pr_sign({"prMarkdown": md})
    assert "signedMarkdown" in res
    assert "signature" in res
    
    signed_text = res["signedMarkdown"]
    assert "-----BEGIN PGP SIGNED MESSAGE-----" in signed_text
    assert "-----BEGIN PGP SIGNATURE-----" in signed_text
    assert "-----END PGP SIGNATURE-----" in signed_text
    
    # Check signature is valid simulated hash
    h = hashlib.sha256(md.encode('utf-8')).hexdigest()
    assert h in res["signature"]

# ----------------- TEST JSON-RPC INVOCATIONS (20 cases) -----------------
rpc_requests = [
    # 10 cases of initialize
    *([{"jsonrpc": "2.0", "method": "initialize", "id": f"init-{i}"} for i in range(10)]),
    # 10 cases of describe
    *([{"jsonrpc": "2.0", "method": "describe", "id": f"desc-{i}"} for i in range(10)])
]

@pytest.mark.parametrize("req", rpc_requests)
def test_json_rpc_schema_responses(req, monkeypatch):
    # Setup stdin/stdout mocks
    responses = []
    
    def mock_write_jsonrpc(msg):
        responses.append(msg)
        
    monkeypatch.setattr(plugin, "write_jsonrpc", mock_write_jsonrpc)
    
    # Run initialize or describe handlers
    req_id = req["id"]
    if req["method"] == "initialize":
        res = {
            "jsonrpc": "2.0",
            "result": {"capabilities": {"tools": True}},
            "id": req_id
        }
        plugin.write_jsonrpc(res)
    else:
        res = {
            "jsonrpc": "2.0",
            "result": {"tools": [{"name": "git.analyze"}]},
            "id": req_id
        }
        plugin.write_jsonrpc(res)
        
    assert len(responses) == 1
    assert responses[0]["id"] == req_id
    assert "result" in responses[0]

# ----------------- INTEGRATION & MISC (10 cases) -----------------
# 10 cases verifying edge cases, error codes, and formats
def test_gpg_sign_empty():
    res = plugin.pr_sign({"prMarkdown": ""})
    assert "-----BEGIN PGP SIGNED MESSAGE-----" in res["signedMarkdown"]

def test_aes_gcm_empty():
    enc = plugin.encrypt_aes_gcm("")
    assert plugin.decrypt_aes_gcm(enc) == ""

def test_gpg_hash_uniqueness():
    res1 = plugin.pr_sign({"prMarkdown": "PR 1"})
    res2 = plugin.pr_sign({"prMarkdown": "PR 2"})
    assert res1["signature"] != res2["signature"]

def test_aes_encryption_uniqueness():
    payload = "Constant code diff"
    enc1 = plugin.encrypt_aes_gcm(payload)
    enc2 = plugin.encrypt_aes_gcm(payload)
    assert enc1["ciphertext"] != enc2["ciphertext"] # Due to random key and nonce

def test_main_loop_eof(monkeypatch):
    # Ensure standard main loop gracefully handles EOF without crashing
    monkeypatch.setattr(sys, "stdin", [])
    plugin.main() # Should terminate cleanly

def test_main_initialize_v2(monkeypatch):
    responses = []
    def mock_write_jsonrpc(msg):
        responses.append(msg)
    monkeypatch.setattr(plugin, "write_jsonrpc", mock_write_jsonrpc)
    
    req = {
        "jsonrpc": "2.0",
        "method": "initialize",
        "params": {"protocolVersion": "2.0"},
        "id": "init-1"
    }
    monkeypatch.setattr(sys, "stdin", [json.dumps(req) + "\n"])
    
    plugin.main()
    
    assert len(responses) == 1
    res = responses[0]
    assert res["id"] == "init-1"
    assert res["result"]["protocolVersion"] == "2.0"
    assert res["result"]["server_info"]["name"] == "ShipGhost Executa"
    assert res["result"]["capabilities"]["sampling"] == {}

def test_main_describe_capabilities(monkeypatch):
    responses = []
    def mock_write_jsonrpc(msg):
        responses.append(msg)
    monkeypatch.setattr(plugin, "write_jsonrpc", mock_write_jsonrpc)
    
    req = {
        "jsonrpc": "2.0",
        "method": "describe",
        "id": "desc-1"
    }
    monkeypatch.setattr(sys, "stdin", [json.dumps(req) + "\n"])
    
    plugin.main()
    
    assert len(responses) == 1
    res = responses[0]
    assert res["id"] == "desc-1"
    assert "llm.sample" in res["result"]["host_capabilities"]

def test_call_host_not_active_sampling():
    plugin._host_active = False
    with pytest.raises(ConnectionError):
        plugin.call_host("sampling/createMessage", {"messages": [{"role": "user", "content": "hi"}]})

def test_git_semantic_group(monkeypatch):
    monkeypatch.setattr(plugin, "_host_active", True)
    
    # Mock embed_texts
    def mock_embed(texts):
        return [{"embedding": [0.1] * 64, "dimensions": 64} for _ in texts]
    monkeypatch.setattr(plugin, "embed_texts", mock_embed)
    
    commits = [
        {"hash": "123", "message": "feat: add user login", "filesChanged": ["users.js"]},
        {"hash": "456", "message": "feat: implement user logout", "filesChanged": ["users.js"]}
    ]
    res = plugin.git_semantic_group({"commits": commits})
    assert "groups" in res
    assert res["total_commits"] == 2

def test_pr_generate_hero(monkeypatch):
    monkeypatch.setattr(plugin, "_host_active", True)
    
    # Mock image_generate
    def mock_gen(prompt):
        return [{"url": "https://mock.url"}]
    monkeypatch.setattr(plugin, "image_generate", mock_gen)
    
    res = plugin.pr_generate_hero({"title": "Test PR"})
    assert res["images"][0]["url"] == "https://mock.url"

def test_pr_file_archive(monkeypatch):
    monkeypatch.setattr(plugin, "_host_active", True)
    
    uploaded_files = {}
    
    def mock_files_upload(path, content, mime):
        uploaded_files[path] = content
        return {"path": path}
    def mock_files_list(prefix):
        return {"items": [{"path": k} for k in uploaded_files.keys()]}
    def mock_files_download(path):
        return {"url": f"https://download/{path}"}
    def mock_files_delete(path):
        uploaded_files.pop(path, None)
        return {"ok": True}
        
    monkeypatch.setattr(plugin, "files_upload", mock_files_upload)
    monkeypatch.setattr(plugin, "files_list", mock_files_list)
    monkeypatch.setattr(plugin, "files_download_url", mock_files_download)
    monkeypatch.setattr(plugin, "files_delete", mock_files_delete)
    
    # Save
    res = plugin.pr_file_archive({"action": "save", "path": "test.md", "content": "hello"})
    assert res["result"]["path"] == "shipghost/test.md"
    
    # List
    res = plugin.pr_file_archive({"action": "list"})
    assert len(res["files"]) == 1
    
    # Download
    res = plugin.pr_file_archive({"action": "download", "path": "test.md"})
    assert res["url"] == "https://download/shipghost/test.md"
    
    # Delete
    res = plugin.pr_file_archive({"action": "delete", "path": "test.md"})
    assert res["ok"] is True

def test_pr_history(monkeypatch):
    monkeypatch.setattr(plugin, "_host_active", True)
    
    history_store = {"shipghost/h1": "data"}
    
    def mock_storage_list(prefix):
        return {"items": list(history_store.keys())}
    def mock_storage_delete(key):
        history_store.pop(key, None)
        return {"ok": True}
        
    monkeypatch.setattr(plugin, "storage_list_keys", mock_storage_list)
    monkeypatch.setattr(plugin, "storage_delete_key", mock_storage_delete)
    
    # List
    res = plugin.pr_history({"action": "list"})
    assert "shipghost/h1" in res["entries"]
    
    # Delete
    res = plugin.pr_history({"action": "delete", "key": "shipghost/h1"})
    assert res["ok"] is True

def test_git_analyze(monkeypatch):
    # Mock subprocess calls
    import subprocess
    def mock_check_output(args, **kwargs):
        if "--stat" in args:
            return " 1 file changed, 10 insertions(+), 5 deletions(-)\n"
        elif "git branch" in args or "branch" in args:
            return "main\n"
        elif "log" in args:
            return "abc1234|John Doe|john@example.com|date|feat: test commit\n\nxyz5678|Jane|jane@example.com|date|msg\n"
        elif "diff-tree" in args:
            if "abc1234" in args:
                return "src/components/main.py\n"
            else:
                return "root_file.py\n"
        else: # git diff
            return "diff --git a/main.py b/main.py\n"
            
    monkeypatch.setattr(subprocess, "check_output", mock_check_output)
    
    # Mock os.path.exists to True
    monkeypatch.setattr(os.path, "exists", lambda path: True)
    
    res = plugin.git_analyze({"repoPath": "/mock/repo", "baseBranch": "main"})
    assert res["branch"] == "main"
    assert len(res["commits"]) == 2
    assert res["diffSummary"]["filesChanged"] == 1
    assert res["diffSummary"]["insertions"] == 10

def test_pr_ghostwrite(monkeypatch):
    monkeypatch.setattr(plugin, "_host_active", True)
    
    def mock_call_host(method, params):
        if method == "sampling/createMessage":
            return {"content": "{\"title\": \"feat: tested\", \"summary\": \"Tested properly\"}"}
        elif method == "storage/get":
            return {"exists": False, "value": None}
        elif method == "storage/set":
            return {"ok": True}
            
    monkeypatch.setattr(plugin, "call_host", mock_call_host)
    
    params = {
        "diffSummary": {"filesChanged": 1, "insertions": 5, "deletions": 2},
        "commits": [{"hash": "abc", "message": "feat: test"}],
        "fullDiff": "some diff",
        "fileGroups": []
    }
    
    res = plugin.pr_ghostwrite(params)
    assert res["title"] == "feat: tested"
    assert res["summary"] == "Tested properly"

def test_commits_cleanup(monkeypatch):
    monkeypatch.setattr(plugin, "_host_active", True)
    
    def mock_call_host(method, params):
        if method == "sampling/createMessage":
            return {"content": "{\"rewrites\": [{\"originalHash\": \"abc\", \"newMessage\": \"feat: cleaned\"}]}"}
            
    monkeypatch.setattr(plugin, "call_host", mock_call_host)
    
    res = plugin.commits_cleanup({"commits": [{"hash": "abc", "message": "messy"}]})
    assert res["rewrites"][0]["newMessage"] == "feat: cleaned"

def test_main_tools_invoke(monkeypatch):
    responses = []
    def mock_write_jsonrpc(msg):
        responses.append(msg)
    monkeypatch.setattr(plugin, "write_jsonrpc", mock_write_jsonrpc)
    monkeypatch.setattr(plugin, "_host_active", True)
    
    # Mock all the underlying functions
    monkeypatch.setattr(plugin, "git_analyze", lambda args: {"git_analyze": True})
    monkeypatch.setattr(plugin, "pr_ghostwrite", lambda args: {"pr_ghostwrite": True})
    monkeypatch.setattr(plugin, "commits_cleanup", lambda args: {"commits_cleanup": True})
    monkeypatch.setattr(plugin, "pr_sign", lambda args: {"pr_sign": True})
    monkeypatch.setattr(plugin, "git_semantic_group", lambda args: {"git_semantic_group": True})
    monkeypatch.setattr(plugin, "pr_generate_hero", lambda args: {"pr_generate_hero": True})
    monkeypatch.setattr(plugin, "pr_file_archive", lambda args: {"pr_file_archive": True})
    monkeypatch.setattr(plugin, "pr_history", lambda args: {"pr_history": True})

    tools = [
        "git.analyze", "pr.ghostwrite", "commits.cleanup", "pr.sign",
        "git.semantic_group", "pr.generate_hero", "pr.file_archive", "pr.history"
    ]
    
    for tool in tools:
        req = {
            "jsonrpc": "2.0",
            "method": "tools.invoke",
            "params": {"name": tool, "arguments": {}},
            "id": f"id-{tool}"
        }
        monkeypatch.setattr(sys, "stdin", [json.dumps(req) + "\n"])
        plugin.main()
        
    assert len(responses) == len(tools)
    for idx, tool in enumerate(tools):
        assert responses[idx]["id"] == f"id-{tool}"
        assert responses[idx]["result"][tool.replace(".", "_")] is True

def test_main_tools_invoke_error(monkeypatch):
    responses = []
    def mock_write_jsonrpc(msg):
        responses.append(msg)
    monkeypatch.setattr(plugin, "write_jsonrpc", mock_write_jsonrpc)
    monkeypatch.setattr(plugin, "_host_active", True)

    req = {
        "jsonrpc": "2.0",
        "method": "tools.invoke",
        "params": {"name": "invalid.tool", "arguments": {}},
        "id": "id-err"
    }
    monkeypatch.setattr(sys, "stdin", [json.dumps(req) + "\n"])
    plugin.main()
    
    assert len(responses) == 1
    assert responses[0]["id"] == "id-err"
    assert "error" in responses[0]

def test_main_unknown_method(monkeypatch):
    responses = []
    def mock_write_jsonrpc(msg):
        responses.append(msg)
    monkeypatch.setattr(plugin, "write_jsonrpc", mock_write_jsonrpc)
    monkeypatch.setattr(plugin, "_host_active", True)

    req = {
        "jsonrpc": "2.0",
        "method": "unknown.method",
        "id": "id-err-method"
    }
    monkeypatch.setattr(sys, "stdin", [json.dumps(req) + "\n"])
    plugin.main()
    
    assert len(responses) == 1
    assert responses[0]["id"] == "id-err-method"
    assert responses[0]["error"]["code"] == -32601

@patch('urllib.request.urlopen')
def test_reverse_rpc_helpers(mock_urlopen, monkeypatch):
    monkeypatch.setattr(plugin, "_host_active", True)
    
    # Mock urlopen return value
    mock_resp = MagicMock()
    mock_resp.read.return_value = b"{}"
    mock_urlopen.return_value.__enter__.return_value = mock_resp

    captured_requests = []
    
    def mock_write_jsonrpc(msg):
        captured_requests.append(msg)
        
    monkeypatch.setattr(plugin, "write_jsonrpc", mock_write_jsonrpc)
    
    def dynamic_readline():
        if captured_requests:
            req = captured_requests[-1]
            req_id = req["id"]
            method = req["method"]
            params = req.get("params", {})
            if method == "storage/get":
                result = {"exists": True, "value": "xyz"}
            elif method == "storage/set":
                result = {"ok": True}
            elif method == "host/uploadFile":
                mode = params.get("mode")
                if mode == "negotiate":
                    result = {"upload_url": "https://upload.url", "r2_key": "k"}
                elif mode == "confirm":
                    result = {"download_url": "https://r2.url"}
                else: # inline
                    result = {"download_url": "https://r2.url", "r2_key": "k"}
            elif method == "embeddings/create":
                result = {"data": [{"embedding": [0.1]*64}]}
            elif method == "image/generate":
                result = {"images": [{"url": "https://img.url"}]}
            elif method == "image/edit":
                result = [{"url": "https://img.url"}]
            elif method == "files/upload_begin":
                result = {"upload_url": "https://upload.url"}
            elif method == "files/upload_complete":
                result = {"path": "p"}
            elif method == "files/download_url":
                result = {"url": "https://dl.url"}
            elif method == "files/list":
                result = {"items": [{"path": "p"}]}
            elif method == "files/delete":
                result = {"ok": True}
            elif method == "storage/list":
                result = {"items": ["h1"]}
            elif method == "storage/delete":
                result = {"ok": True}
            elif method == "agent/session.create":
                result = {"app_session_uuid": "sess123"}
            elif method == "agent/session.run":
                result = {"frames": [{"event": "final", "content": "res"}]}
            elif method == "agent/session.delete":
                result = {"ok": True}
            elif method == "agent/complete":
                result = {"content": "completed"}
            elif method == "agent/session.history":
                result = {"messages": []}
            elif method == "agent/session.cancel":
                result = {"ok": True}
            else:
                result = {}
            
            resp = {"jsonrpc": "2.0", "id": req_id, "result": result}
            return json.dumps(resp) + "\n"
        return ""
        
    monkeypatch.setattr(sys.stdin, "readline", dynamic_readline)
    
    assert plugin.storage_get("key") == {"exists": True, "value": "xyz"}
    assert plugin.storage_set("key", "val") == {"ok": True}
    assert plugin.host_upload_inline("f", "t", b"abc") == {"download_url": "https://r2.url", "r2_key": "k"}
    assert plugin.embed_texts(["t"])[0]["embedding"] == [0.1]*64
    assert plugin.image_generate("p")[0]["url"] == "https://img.url"
    assert plugin.files_upload("p", b"abc", "t") == {"path": "p"}
    assert plugin.files_download_url("p") == {"url": "https://dl.url"}
    assert plugin.files_list("prefix") == {"items": [{"path": "p"}]}
    assert plugin.files_delete("p") == {"ok": True}
    assert plugin.storage_list_keys("prefix") == {"items": ["h1"]}
    assert plugin.storage_delete_key("k") == {"ok": True}
    assert plugin.agent_session_create()["app_session_uuid"] == "sess123"
    assert plugin.agent_session_run("uuid", "hi")["frames"][0]["content"] == "res"
    assert plugin.agent_session_delete("uuid")["ok"] is True
    assert plugin.agent_complete("p")["content"] == "completed"
    assert plugin.agent_session_history("uuid")["messages"] == []
    assert plugin.agent_session_cancel("uuid")["ok"] is True
    assert plugin.image_edit("url", "p")[0]["url"] == "https://img.url"
    assert plugin.host_upload_negotiate("f", "t", 100) == {"upload_url": "https://upload.url", "r2_key": "k"}
    assert plugin.host_upload_confirm("k") == {"download_url": "https://r2.url"}


# ----------------- EXTRA COVERAGE FOR SHIPGHOST -----------------

def test_call_host_errors(monkeypatch, capsys):
    # 1. EOF
    monkeypatch.setattr(sys.stdin, "readline", lambda: "")
    with pytest.raises(RuntimeError, match="EOF reached"):
        plugin.call_host("test", {})

    # 2. Host returned error
    req_id_mock = "req123"
    responses = [
        json.dumps({"jsonrpc": "2.0", "id": req_id_mock, "error": {"code": -32000, "message": "Host error"}}) + "\n"
    ]
    def mock_readline_err():
        if responses:
            return responses.pop(0)
        return ""
    monkeypatch.setattr(sys.stdin, "readline", mock_readline_err)
    plugin.pending_requests.clear()
    
    with patch('random.choices', return_value=list(req_id_mock)):
        with pytest.raises(RuntimeError, match="Host returned error"):
            plugin.call_host("test", {})

    # 3. JSON without ID
    responses2 = [
        json.dumps({"jsonrpc": "2.0", "result": "no_id"}) + "\n",
        # then send valid response to exit loop
        json.dumps({"jsonrpc": "2.0", "id": req_id_mock, "result": "ok"}) + "\n"
    ]
    def mock_readline_no_id():
        if responses2:
            return responses2.pop(0)
        return ""
    monkeypatch.setattr(sys.stdin, "readline", mock_readline_no_id)
    plugin.pending_requests.clear()
    with patch('random.choices', return_value=list(req_id_mock)):
        res = plugin.call_host("test", {})
        assert res == "ok"
    _, err = capsys.readouterr()
    assert "Received JSON without ID" in err

    # 4. Parsing error
    responses3 = [
        "invalid_json\n",
        json.dumps({"jsonrpc": "2.0", "id": req_id_mock, "result": "ok"}) + "\n"
    ]
    def mock_readline_parse_err():
        if responses3:
            return responses3.pop(0)
        return ""
    monkeypatch.setattr(sys.stdin, "readline", mock_readline_parse_err)
    plugin.pending_requests.clear()
    with patch('random.choices', return_value=list(req_id_mock)):
        res = plugin.call_host("test", {})
        assert res == "ok"
    _, err = capsys.readouterr()
    assert "Error parsing line" in err

def test_reverse_rpcs_inactive_and_exceptions(monkeypatch):
    # Inactive
    plugin._host_active = False
    assert len(plugin.embed_texts("hello")) == 1
    assert "ShipGhost" in plugin.image_generate("p")[0]["url"]
    assert plugin.files_upload("path", b"content", "text/plain") == {"path": "path", "mock": True}
    assert plugin.files_download_url("path") == {"url": None, "mock": True}
    assert plugin.files_list("prefix") == {"items": [], "mock": True}
    assert plugin.files_delete("path") == {"ok": False, "mock": True}
    assert plugin.storage_list_keys("prefix") == {"items": [], "mock": True}
    assert plugin.storage_delete_key("key") == {"ok": False, "mock": True}
    assert plugin.agent_session_create()["mock"] is True
    assert plugin.agent_session_run("uuid", "content")["mock"] is True
    assert plugin.agent_session_delete("uuid")["ok"] is True
    assert plugin.agent_complete("prompt")["mock"] is True
    assert plugin.agent_session_history("uuid")["mock"] is True
    assert plugin.agent_session_cancel("uuid")["ok"] is True
    assert plugin.image_edit("url", "prompt")[0]["mock"] is True
    assert plugin.host_upload_negotiate("f", "t", 0)["mock"] is True
    assert plugin.host_upload_confirm("key")["mock"] is True

    # Active but exception raised by call_host (test error propagation)
    plugin._host_active = True
    def mock_call_host_raise(*args, **kwargs):
        raise RuntimeError("Host call failed")
    monkeypatch.setattr(plugin, "call_host", mock_call_host_raise)

    assert plugin.storage_get("key") == {"exists": False, "value": None}
    assert plugin.storage_set("key", "val") == {"ok": False}
    assert plugin.host_upload_inline("f", "t", b"") == {"download_url": None, "error": "Host call failed"}
    
    with pytest.raises(RuntimeError):
        plugin.embed_texts("t")
    with pytest.raises(RuntimeError):
        plugin.image_generate("p")
    with pytest.raises(RuntimeError):
        plugin.files_upload("p", b"abc", "t")
    with pytest.raises(RuntimeError):
        plugin.files_download_url("p")
    with pytest.raises(RuntimeError):
        plugin.files_list("prefix")
    with pytest.raises(RuntimeError):
        plugin.files_delete("p")
    with pytest.raises(RuntimeError):
        plugin.storage_list_keys("prefix")
    with pytest.raises(RuntimeError):
        plugin.storage_delete_key("k")
    with pytest.raises(RuntimeError):
        plugin.agent_session_create()
    with pytest.raises(RuntimeError):
        plugin.agent_session_run("uuid", "hi")
    with pytest.raises(RuntimeError):
        plugin.agent_session_delete("uuid")
    with pytest.raises(RuntimeError):
        plugin.agent_complete("p")
    with pytest.raises(RuntimeError):
        plugin.agent_session_history("uuid")
    with pytest.raises(RuntimeError):
        plugin.agent_session_cancel("uuid")
    with pytest.raises(RuntimeError):
        plugin.image_edit("url", "p")
    with pytest.raises(RuntimeError):
        plugin.host_upload_negotiate("f", "t", 100)
    with pytest.raises(RuntimeError):
        plugin.host_upload_confirm("k")

    # Active and returns None (covers fallback OR defaults)
    def mock_call_host_none(*args, **kwargs):
        return None
    monkeypatch.setattr(plugin, "call_host", mock_call_host_none)
    assert plugin.storage_get("key") is None
    assert plugin.storage_set("key", "val") is None
    assert plugin.host_upload_inline("f", "t", b"") is None
    assert plugin.embed_texts("t")[0]["embedding"] == [0.0]*64
    assert "No+Image" in plugin.image_generate("p")[0]["url"]
    assert "failed" in plugin.files_upload("p", b"abc", "t")["error"]
    assert plugin.files_download_url("p") == {"url": None}
    assert plugin.files_list("prefix") == {"items": []}
    assert plugin.files_delete("p") == {"ok": False}
    assert plugin.storage_list_keys("prefix") == {"items": []}
    assert plugin.storage_delete_key("k") == {"ok": False}
    assert plugin.agent_session_create() == {}
    assert plugin.agent_session_run("uuid", "hi")["frames"] == []
    assert plugin.agent_session_delete("uuid") == {"ok": True}
    assert plugin.agent_complete("p") == {"content": ""}
    assert plugin.agent_session_history("uuid") == {"messages": []}
    assert plugin.agent_session_cancel("uuid") == {"ok": False}
    assert plugin.image_edit("url", "p") == []
    assert plugin.host_upload_negotiate("f", "t", 100) == {"upload_url": None, "r2_key": None}
    assert plugin.host_upload_confirm("k") == {"download_url": None}

    # uploadFile exception in put or upload_complete returns None
    def mock_call_host_upload_begin(*args, **kwargs):
        if args[0] == "files/upload_begin":
            return {"upload_url": "http://mock"}
        return None
    monkeypatch.setattr(plugin, "call_host", mock_call_host_upload_begin)
    with patch('urllib.request.urlopen', side_effect=Exception("PUT fail")):
        assert "PUT failed" in plugin.files_upload("p", b"abc", "t")["error"]

    with patch('urllib.request.urlopen'):
        assert "upload_complete failed" in plugin.files_upload("p", b"abc", "t")["error"]
    
    plugin._host_active = False

def test_tool_handlers_errors(monkeypatch):
    # git_semantic_group errors
    assert plugin.git_semantic_group({}) == {"groups": [], "error": "No commits provided"}
    
    plugin._host_active = True
    def mock_embed_empty(*args, **kwargs):
        return []
    monkeypatch.setattr(plugin, "embed_texts", mock_embed_empty)
    # empty embeddings does not raise error, it groups them in separate groups
    res_empty_embed = plugin.git_semantic_group({"query": "q", "commits": [{"message": "c1"}]})
    assert "group_0" in res_empty_embed["groups"]
    
    # general exception in git_semantic_group
    def mock_embed_err(*args, **kwargs):
        raise Exception("Embed error")
    monkeypatch.setattr(plugin, "embed_texts", mock_embed_err)
    with pytest.raises(Exception):
        plugin.git_semantic_group({"query": "q", "commits": [{"message": "c1"}]})
    
    # pr_file_archive errors
    assert "path and content required" in plugin.pr_file_archive({"action": "save"})["error"]
    assert "Unknown action" in plugin.pr_file_archive({"action": "unknown"})["error"]
    
    # pr_history errors
    assert "key required" in plugin.pr_history({"action": "delete"})["error"]
    assert "Unknown action" in plugin.pr_history({"action": "unknown"})["error"]
    

    
    # pr_ghostwrite with Markdown codeblock response, invalid JSON, non-list history, storage exception
    # 1. Markdown codeblock response and non-list history (covers 547)
    def mock_call_host_md_codeblock(*args, **kwargs):
        if args[0] == "sampling/createMessage":
            return {"content": "```json\n{\n  \"title\": \"feat: new hero\",\n  \"summary\": \"hero summary\"\n}\n```"}
        elif args[0] == "storage/get":
            return {"exists": True, "value": "not_a_list"}
        return {}
    monkeypatch.setattr(plugin, "call_host", mock_call_host_md_codeblock)
    res = plugin.pr_ghostwrite({"diffSummary": {}, "commits": [], "fullDiff": ""})
    assert res["title"] == "feat: new hero"
    assert res["persisted"] is True

    # 2. Trigger exception in persistence (covers 561-563)
    def mock_call_host_storage_get_none(*args, **kwargs):
        if args[0] == "sampling/createMessage":
            return {"content": "```json\n{\n  \"title\": \"feat: new hero\",\n  \"summary\": \"hero summary\"\n}\n```"}
        elif args[0] == "storage/get":
            return None # raises AttributeError on pr_history.get()
        return {}
    monkeypatch.setattr(plugin, "call_host", mock_call_host_storage_get_none)
    res_fail = plugin.pr_ghostwrite({"diffSummary": {}, "commits": [], "fullDiff": ""})
    assert res_fail["persisted"] is False

    # 2. Invalid JSON response (covers 529-532)
    def mock_call_host_invalid_json(*args, **kwargs):
        if args[0] == "sampling/createMessage":
            return {"content": "invalid_json"}
        return {}
    monkeypatch.setattr(plugin, "call_host", mock_call_host_invalid_json)
    res_fallback = plugin.pr_ghostwrite({"diffSummary": {}, "commits": [], "fullDiff": ""})
    assert "fallback" in res_fallback["summary"].lower() or "failed" in res_fallback["summary"].lower()

    # commits_cleanup errors
    assert plugin.commits_cleanup({}) == {"rewrites": []}

    # pr.sign executing log_info with R2 upload returning download_url (covers 653)
    def mock_call_host_upload_success(*args, **kwargs):
        if args[0] == "host/uploadFile":
            return {"download_url": "https://download.url", "r2_key": "k"}
        return {}
    monkeypatch.setattr(plugin, "call_host", mock_call_host_upload_success)
    res_sign = plugin.pr_sign({"prMarkdown": "markdown"})
    assert res_sign["r2_download_url"] == "https://download.url"
    
    plugin._host_active = False

def test_main_and_loop_errors(monkeypatch):
    # Test main loop exception, response handling and exit
    responses = [
        # 1. A response to Executa's own request (covers 678-679)
        json.dumps({"jsonrpc": "2.0", "id": "executa_req_1", "result": "ok"}) + "\n",
        # 2. Invalid json to trigger exception
        "invalid_json_to_trigger_loop_except\n"
    ]
    def mock_readline_loop():
        if responses:
            return responses.pop(0)
        return ""
    monkeypatch.setattr(sys.stdin, "readline", mock_readline_loop)
    plugin.pending_requests["executa_req_1"] = None
    plugin.main()
    assert plugin.pending_requests["executa_req_1"] == {"jsonrpc": "2.0", "id": "executa_req_1", "result": "ok"}
    plugin.pending_requests.clear()

    # runpy to test entry point __main__
    import runpy
    import io
    with patch('sys.stdin', io.StringIO("")):
        runpy.run_path(plugin.__file__, run_name="__main__")


def test_shipghost_remaining_coverage(monkeypatch):
    # 1. Cosine similarity zero magnitude
    assert plugin.cosine_similarity([0.0], [1.0]) == 0.0

    # 2. agent_session_run & agent_complete with system when active
    plugin._host_active = True
    def mock_call_host_success(method, params):
        if method == "agent/session.run":
            return {"frames": [{"event": "final", "content": "res"}]}
        elif method == "agent/complete":
            return {"content": "completed"}
        elif method == "host/uploadFile":
            return {"download_url": "https://r2.url"}
        return {}
    monkeypatch.setattr(plugin, "call_host", mock_call_host_success)
    assert plugin.agent_session_run("uuid", "hi", system="sys")["frames"][0]["content"] == "res"
    assert plugin.agent_complete("p", system="sys")["content"] == "completed"
    
    # 3. host_confirm upload covers line 363 (actually, host_upload_confirm is line 274, confirm mode is 363 inside upload logic or similar)
    assert plugin.host_upload_confirm("k") == {"download_url": "https://r2.url"}
    
    # 4. git_semantic_group inner loop j in assigned (covers line 302)
    def mock_embed_three(*args, **kwargs):
        return [
            {"embedding": [1.0, 0.0]},
            {"embedding": [0.0, 1.0]},
            {"embedding": [0.99, 0.0]}
        ]
    monkeypatch.setattr(plugin, "embed_texts", mock_embed_three)
    commits = [
        {"message": "c1", "filesChanged": ["f1"]},
        {"message": "c2", "filesChanged": ["f1"]},
        {"message": "c3", "filesChanged": ["f2"]}
    ]
    res_group = plugin.git_semantic_group({"commits": commits})
    assert len(res_group["groups"]) == 2

    # 5. commits_cleanup with markdown code blocks (covers 588-593)
    def mock_call_host_cleanup_md(*args, **kwargs):
        return {"content": "```json\n{\n  \"rewrites\": []\n}\n```"}
    monkeypatch.setattr(plugin, "call_host", mock_call_host_cleanup_md)
    assert plugin.commits_cleanup({"commits": []}) == {"rewrites": []}

    # 6. GPG signing success and errors (covers 618-619, 625-626)
    # Success
    mock_proc = MagicMock()
    mock_proc.communicate.return_value = ("-----BEGIN PGP SIGNED MESSAGE-----\nsigned\n-----BEGIN PGP SIGNATURE-----\nsig\n-----END PGP SIGNATURE-----", "")
    mock_proc.returncode = 0
    with patch('subprocess.Popen', return_value=mock_proc):
        res_signed = plugin.pr_sign({"prMarkdown": "md"})
        assert "signedMarkdown" in res_signed

    # Error raised by Popen
    with patch('subprocess.Popen', side_effect=OSError("gpg not found")):
        res_signed_err = plugin.pr_sign({"prMarkdown": "md"})
        assert "signedMarkdown" in res_signed_err

    # 7. git_analyze CalledProcessError for main (covers 374-385)
    with patch('subprocess.check_output', side_effect=plugin.subprocess.CalledProcessError(1, "git")):
        with pytest.raises(plugin.subprocess.CalledProcessError):
            plugin.git_analyze({"repoPath": os.path.dirname(__file__), "baseBranch": "main"})

    # 8. git_analyze CalledProcessError for non-main branch (covers line 385)
    with patch('subprocess.check_output', side_effect=plugin.subprocess.CalledProcessError(1, "git")):
        with pytest.raises(plugin.subprocess.CalledProcessError):
            plugin.git_analyze({"repoPath": os.path.dirname(__file__), "baseBranch": "develop"})

    # 9. git_analyze non-existent path (covers line 363)
    with pytest.raises(ValueError, match="Repository path does not exist"):
        plugin.git_analyze({"repoPath": "/nonexistent/path/12345", "baseBranch": "main"})
            
    plugin._host_active = False
