use base64::{engine::general_purpose::STANDARD, Engine};
use changyi_desktop::{
    api::{dispatch, ApiRequest},
    database,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs;
use tempfile::TempDir;

struct Fixture {
    dir: TempDir,
    db: Connection,
}
impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let db = database::open(dir.path()).unwrap();
        Self { dir, db }
    }
    fn request(&mut self, method: &str, path: &str, body: Value) -> Result<Value, String> {
        dispatch(
            &mut self.db,
            self.dir.path(),
            &ApiRequest {
                method: method.into(),
                path: path.into(),
                body,
            },
        )
    }
    fn create(&mut self) -> String {
        self.request(
            "POST",
            "/api/projects",
            json!({"name":"测试小说","language":"zh"}),
        )
        .unwrap()["project"]["id"]
            .as_str()
            .unwrap()
            .to_string()
    }
    fn import(&mut self, id: &str, content: &str) -> Value {
        self.request(
            "POST",
            &format!("/api/projects/{id}/import"),
            import_body(content),
        )
        .unwrap()
    }
    fn chapters(&mut self, id: &str) -> Vec<Value> {
        self.request("GET", &format!("/api/projects/{id}/chapters"), Value::Null)
            .unwrap()["chapters"]
            .as_array()
            .unwrap()
            .clone()
    }
}
fn import_body(content: &str) -> Value {
    json!({"fileName":"小说.txt","format":"txt","encoding":"UTF-8","bytes":STANDARD.encode(content.as_bytes()),"warnings":[],"chapters":[{"volumeNumber":null,"volumeTitle":null,"rawTitle":"第一章 开始","normalizedIndex":1,"content":content,"startOffset":0,"endOffset":content.encode_utf16().count(),"confidence":1.0,"flags":[]}]})
}

#[test]
fn workspace_destination_copy_and_pointer_recovery_preserve_source() {
    let mut f = Fixture::new();
    let project = f.create();
    f.import(&project, "独立副本的原文。");
    let parent = tempfile::tempdir().unwrap();
    let target = parent.path().join("workspace");
    let copied = changyi_desktop::storage::prepare_destination(f.dir.path(), &target).unwrap();
    assert_eq!(
        database::query(&copied, "SELECT name FROM NovelProject", &[])
            .unwrap()
            .len(),
        1
    );
    database::execute(&copied, "UPDATE NovelProject SET name='副本'", &[]).unwrap();
    assert_eq!(
        database::query(&f.db, "SELECT name FROM NovelProject", &[]).unwrap()[0]["name"],
        "测试小说"
    );
    assert!(changyi_desktop::storage::copy_to(f.dir.path(), &f.dir.path().join("nested")).is_err());
    let nonempty = parent.path().join("nonempty");
    fs::create_dir(&nonempty).unwrap();
    fs::write(nonempty.join("keep.txt"), "保留").unwrap();
    assert!(changyi_desktop::storage::prepare_destination(f.dir.path(), &nonempty).is_err());
    assert_eq!(
        fs::read_to_string(nonempty.join("keep.txt")).unwrap(),
        "保留"
    );
    let config = parent.path().join("settings");
    changyi_desktop::storage::save_pointer(&config, f.dir.path()).unwrap();
    changyi_desktop::storage::save_pointer(&config, &target).unwrap();
    fs::write(config.join("workspace-path.json"), "{bad").unwrap();
    assert_eq!(
        changyi_desktop::storage::load_pointer(&config).unwrap(),
        f.dir.path()
    );
}

#[test]
fn interrupted_run_resumes_and_canceled_request_does_not_write_proposals() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc,
        time::{Duration, Instant},
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let server = std::thread::spawn(move || {
        for attempt in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut input = [0u8; 16384];
            let _ = stream.read(&mut input);
            if attempt == 1 {
                entered_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(8)).unwrap();
            }
            let output = json!({"chapterNote":{"summary":"主角归乡。","excerpt":"回到故乡"}});
            let payload =
                json!({"choices":[{"message":{"content":output.to_string()}}]}).to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",payload.len(),payload).unwrap();
        }
    });
    let mut f = Fixture::new();
    let project = f.create();
    f.import(&project, "他回到故乡。");
    let chapter = f.chapters(&project)[0]["id"].as_str().unwrap().to_string();
    let profile = f
        .request(
            "POST",
            "/api/model-profiles",
            json!({"name":"恢复测试","provider":"ollama","model":"mock",
        "baseUrl":format!("http://{address}/v1"),"isLocal":true}),
        )
        .unwrap()["profile"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let interrupted = database::id();
    f.db.execute("INSERT INTO AnalysisRun(id,projectId,taskType,inputRangeJson,modelProfileId,status,progressJson,usageJson,createdAt,updatedAt) VALUES(?,?,'chapter-extract',?,?,'running','{}','{}',?,?)",
        rusqlite::params![interrupted,project,json!({"chapterIds":[chapter]}).to_string(),profile,database::now(),database::now()]).unwrap();
    let view = f
        .request("GET", &format!("/api/analysis/{interrupted}"), Value::Null)
        .unwrap();
    assert_eq!(view["run"]["status"], "stalled");
    assert_eq!(view["run"]["progress"]["unitsTotal"], 1);
    f.request(
        "POST",
        &format!("/api/analysis/{interrupted}/resume"),
        Value::Null,
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let view = f
            .request("GET", &format!("/api/analysis/{interrupted}"), Value::Null)
            .unwrap();
        if view["run"]["status"] == "done"
            && !changyi_desktop::analysis::is_processing(&interrupted)
        {
            break;
        }
        assert!(
            view["run"]["status"] != "failed",
            "{}",
            view["run"]["error"]
        );
        assert!(Instant::now() < deadline, "resume timed out");
        std::thread::sleep(Duration::from_millis(20));
    }
    let canceled = f
        .request(
            "POST",
            &format!("/api/projects/{project}/analysis"),
            json!({"taskType":"chapter-extract","profileId":profile}),
        )
        .unwrap()["runId"]
        .as_str()
        .unwrap()
        .to_string();
    entered_rx.recv_timeout(Duration::from_secs(8)).unwrap();
    f.request(
        "POST",
        &format!("/api/analysis/{canceled}/cancel"),
        Value::Null,
    )
    .unwrap();
    release_tx.send(()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(8);
    while changyi_desktop::analysis::is_processing(&canceled) {
        assert!(Instant::now() < deadline, "cancel timed out");
        std::thread::sleep(Duration::from_millis(20));
    }
    server.join().unwrap();
    assert_eq!(
        f.request("GET", &format!("/api/analysis/{canceled}"), Value::Null)
            .unwrap()["run"]["status"],
        "canceled"
    );
    assert!(database::query(
        &f.db,
        "SELECT id FROM MemoryProposal WHERE runId=?",
        &[json!(canceled)]
    )
    .unwrap()
    .is_empty());
    changyi_desktop::storage::ensure_idle(&f.db).unwrap();
}

#[test]
fn anthropic_protocol_and_local_endpoint_validation() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        time::Duration,
    };
    assert!(changyi_desktop::model::validate_local_endpoint("https://example.com/v1").is_err());
    assert!(changyi_desktop::model::validate_local_endpoint("http://[::1]:1234/v1").is_ok());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut input = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let count = stream.read(&mut chunk).unwrap();
            assert!(count > 0);
            input.extend_from_slice(&chunk[..count]);
            if let Some(end) = input.windows(4).position(|value| value == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&input[..end]).to_lowercase();
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("content-length:")
                            .and_then(|value| value.trim().parse::<usize>().ok())
                    })
                    .unwrap();
                if input.len() < end + 4 + length {
                    continue;
                }
                assert!(headers.starts_with("post /v1/messages"));
                assert!(headers.contains("anthropic-version: 2023-06-01"));
                let body: Value =
                    serde_json::from_slice(&input[end + 4..end + 4 + length]).unwrap();
                assert!(body["system"].as_str().unwrap().contains("system"));
                assert_eq!(body["messages"][0]["role"], "user");
                break;
            }
        }
        let output = json!({"title":"测试","content":"正文".repeat(1000)}).to_string();
        let payload=json!({"content":[{"type":"text","text":output}],"usage":{"input_tokens":7,"output_tokens":11}}).to_string();
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",payload.len(),payload).unwrap();
    });
    let profile = changyi_desktop::model::Profile {
        provider: "anthropic".into(),
        model: "mock".into(),
        base_url: format!("http://{address}"),
        is_local: true,
        api_key: Some("synthetic-only".into()),
    };
    let (output, usage) =
        changyi_desktop::model::request_json(&profile, "system", "prompt", 100, "draft").unwrap();
    assert_eq!(output["title"], "测试");
    assert_eq!(usage["totalTokens"], 18);
    server.join().unwrap();
}

fn insert_proposal(
    f: &Fixture,
    project: &str,
    target: Option<&str>,
    key: &str,
    content: &str,
) -> String {
    let proposal_id = database::id();
    f.db.execute(
        "INSERT INTO MemoryProposal(id,projectId,kind,category,key,title,content,status,citationsJson,targetEntryId,state,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?)",
        rusqlite::params![proposal_id, project, if target.is_some() { "update" } else { "add" }, "character", key, "主角", content, "confirmed", "[]", target, database::now(), database::now()],
    ).unwrap();
    proposal_id
}

#[test]
fn proposal_review_versions_memory_and_protects_human_edits() {
    let mut f = Fixture::new();
    let project = f.create();
    let add = insert_proposal(&f, &project, None, "hero", "住在城里");
    let listed = f
        .request(
            "GET",
            &format!("/api/projects/{project}/proposals?state=pending"),
            Value::Null,
        )
        .unwrap();
    assert_eq!(listed["counts"]["pending"], 1);
    assert_eq!(listed["proposals"][0]["title"], "主角");
    let accepted = f
        .request("POST", &format!("/api/proposals/{add}/accept"), Value::Null)
        .unwrap();
    assert_eq!(accepted["proposal"]["state"], "accepted");
    let first = f
        .request(
            "GET",
            &format!("/api/projects/{project}/memory"),
            Value::Null,
        )
        .unwrap();
    let first_id = first["entries"][0]["id"].as_str().unwrap().to_string();
    let update = insert_proposal(&f, &project, Some(&first_id), "hero", "搬到山里");
    let result = f
        .request(
            "POST",
            &format!("/api/proposals/{update}/accept"),
            Value::Null,
        )
        .unwrap();
    assert_eq!(result["proposal"]["state"], "accepted");
    let second = f
        .request(
            "GET",
            &format!("/api/projects/{project}/memory"),
            Value::Null,
        )
        .unwrap();
    let second_id = second["entries"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(second["entries"][0]["revision"], 2);
    assert_eq!(second["entries"][0]["content"], "搬到山里");
    let edited = json!({"category":"character","key":"hero","title":"主角","content":"人工改为住在海边","status":"confirmed","citations":[]});
    f.request("PATCH", &format!("/api/memory/{second_id}"), edited)
        .unwrap();
    let conflict = insert_proposal(&f, &project, Some(&first_id), "hero", "模型改为住在森林");
    let result = f
        .request(
            "POST",
            &format!("/api/proposals/{conflict}/accept"),
            Value::Null,
        )
        .unwrap();
    assert_eq!(result["proposal"]["state"], "conflicted");
    assert!(result["message"].as_str().unwrap().contains("人工修改"));
    f.request(
        "POST",
        &format!("/api/proposals/{conflict}/reject"),
        Value::Null,
    )
    .unwrap();
    let current = f
        .request(
            "GET",
            &format!("/api/projects/{project}/memory"),
            Value::Null,
        )
        .unwrap();
    assert_eq!(current["entries"][0]["content"], "人工改为住在海边");
}

#[test]
fn chapter_analysis_calls_local_model_and_creates_reviewable_proposal() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::{Duration, Instant};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        for attempt in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut input = [0u8; 8192];
            let count = stream.read(&mut input).unwrap();
            assert!(String::from_utf8_lossy(&input[..count]).contains("POST /v1/chat/completions"));
            let answer = if attempt == 0 {
                json!({"chapterNote":{"summary":"","excerpt":""}})
            } else {
                json!({"chapterNote":{"summary":"主角回到故乡。","excerpt":"回到故乡"},"events":[],"characters":[],"settings":[],"threads":[],"glossary":[]})
            };
            let payload=json!({"choices":[{"message":{"content":answer.to_string()}}],"usage":{"prompt_tokens":20,"completion_tokens":30,"total_tokens":50}}).to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",payload.len(),payload).unwrap();
        }
    });
    let mut f = Fixture::new();
    let project = f.create();
    f.request(
        "PATCH",
        "/api/settings/automation",
        json!({"autoAccept":false,"autoSynthesis":false}),
    )
    .unwrap();
    f.import(&project, "他回到故乡。");
    let profile=f.request("POST","/api/model-profiles",json!({
        "name":"Mock 模型","provider":"ollama","model":"mock","baseUrl":format!("http://{address}/v1"),"isLocal":true
    })).unwrap()["profile"]["id"].as_str().unwrap().to_string();
    let request = json!({"taskType":"chapter-extract","profileId":profile});
    let preview = f
        .request(
            "POST",
            &format!("/api/projects/{project}/analysis/preview"),
            request.clone(),
        )
        .unwrap();
    assert_eq!(preview["preview"]["unitCount"], 1);
    assert_eq!(preview["preview"]["isLocal"], true);
    let run_id = f
        .request(
            "POST",
            &format!("/api/projects/{project}/analysis"),
            request,
        )
        .unwrap()["runId"]
        .as_str()
        .unwrap()
        .to_string();
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let run = f
            .request("GET", &format!("/api/analysis/{run_id}"), Value::Null)
            .unwrap()["run"]
            .clone();
        if run["status"] == "done" {
            assert_eq!(run["progress"]["produced"], 1);
            break;
        }
        if run["status"] == "failed" {
            panic!("analysis failed: {}", run["error"]);
        }
        assert!(Instant::now() < deadline, "analysis timed out");
        std::thread::sleep(Duration::from_millis(30));
    }
    server.join().unwrap();
    let listed = f
        .request(
            "GET",
            &format!("/api/projects/{project}/proposals"),
            Value::Null,
        )
        .unwrap();
    assert_eq!(listed["counts"]["pending"], 1);
    assert_eq!(
        listed["proposals"][0]["citations"][0]["excerpt"],
        "回到故乡"
    );
    let cloud = f
        .request(
            "POST",
            "/api/model-profiles",
            json!({
                "name":"远端测试","provider":"openai-compatible","model":"mock",
                "baseUrl":format!("http://{address}/v1"),"apiKey":"synthetic-only","isLocal":false
            }),
        )
        .unwrap()["profile"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let preview = f
        .request(
            "POST",
            &format!("/api/projects/{project}/analysis/preview"),
            json!({"taskType":"chapter-extract","profileId":cloud}),
        )
        .unwrap();
    assert_eq!(preview["preview"]["isLocal"], false);
    assert!(f
        .request(
            "POST",
            &format!("/api/projects/{project}/analysis"),
            json!({"taskType":"chapter-extract","profileId":cloud})
        )
        .unwrap_err()
        .contains("授权"));
}

#[test]
fn book_synthesis_requires_memory_and_creates_inferred_proposals() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::{Duration, Instant};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut input = [0u8; 8192];
        let _ = stream.read(&mut input);
        let content=json!({"overview":"主角已归乡。","endingState":"主角抵达故乡。","unresolved":[{"title":"身份","detail":"尚未公开"}],
            "constraints":["故乡位于北方"],"choices":[],"ambiguities":[]}).to_string();
        let payload =
            json!({"choices":[{"message":{"content":content}}],"usage":{"total_tokens":60}})
                .to_string();
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",payload.len(),payload).unwrap();
    });
    let mut f = Fixture::new();
    let project = f.create();
    f.request(
        "PATCH",
        "/api/settings/automation",
        json!({"autoAccept":false,"autoSynthesis":false}),
    )
    .unwrap();
    f.import(&project, "主角回到北方故乡。");
    let profile = f
        .request(
            "POST",
            "/api/model-profiles",
            json!({"name":"Mock","provider":"ollama",
        "model":"mock","baseUrl":format!("http://{address}/v1"),"isLocal":true}),
        )
        .unwrap()["profile"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let args = json!({"taskType":"book-synthesis","profileId":profile});
    assert!(f
        .request(
            "POST",
            &format!("/api/projects/{project}/analysis/preview"),
            args.clone()
        )
        .unwrap_err()
        .contains("记忆"));
    f.request("POST",&format!("/api/projects/{project}/memory"),
        json!({"category":"character","key":"hero","title":"主角","content":"已回到故乡","status":"confirmed","citations":[]})).unwrap();
    let preview = f
        .request(
            "POST",
            &format!("/api/projects/{project}/analysis/preview"),
            args.clone(),
        )
        .unwrap();
    assert_eq!(preview["preview"]["unitCount"], 1);
    assert_eq!(preview["preview"]["taskLabel"], "全书统合");
    let run_id = f
        .request("POST", &format!("/api/projects/{project}/analysis"), args)
        .unwrap()["runId"]
        .as_str()
        .unwrap()
        .to_string();
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let run = f
            .request("GET", &format!("/api/analysis/{run_id}"), Value::Null)
            .unwrap()["run"]
            .clone();
        if run["status"] == "done" {
            assert_eq!(run["progress"]["produced"], 4);
            break;
        }
        if run["status"] == "failed" {
            panic!("synthesis failed: {}", run["error"]);
        }
        assert!(Instant::now() < deadline, "synthesis timed out");
        std::thread::sleep(Duration::from_millis(30));
    }
    server.join().unwrap();
    let listed = f
        .request(
            "GET",
            &format!("/api/projects/{project}/proposals"),
            Value::Null,
        )
        .unwrap();
    assert_eq!(listed["counts"]["pending"], 4);
    assert!(listed["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row["status"] == "inferred"));
}

#[test]
fn continuation_plans_drafts_and_issues_respect_project_and_versions() {
    let mut f = Fixture::new();
    let project = f.create();
    let other = f.create();
    let plan_id = f
        .request(
            "POST",
            &format!("/api/projects/{project}/plans"),
            json!({"direction":"向北走","summary":"主角将去北境","select":true}),
        )
        .unwrap()["plan"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(f
        .request(
            "GET",
            &format!("/api/projects/{other}/plans/{plan_id}"),
            Value::Null
        )
        .is_err());
    let updated=f.request("PATCH",&format!("/api/projects/{project}/plans/{plan_id}"),json!({
        "expectedVersion":1,"outline":[{"index":7,"title":"北境","summary":"抵达山脚","beats":["出发"],"relatedThreads":[]}]
    })).unwrap();
    assert_eq!(updated["plan"]["version"], 2);
    assert_eq!(updated["plan"]["outline"][0]["index"], 1);
    assert!(f
        .request(
            "PATCH",
            &format!("/api/projects/{project}/plans/{plan_id}"),
            json!({"expectedVersion":1,"summary":"过期修改"})
        )
        .is_err());
    assert!(f
        .request(
            "PATCH",
            &format!("/api/projects/{project}/plans/{plan_id}"),
            json!({"summary":"改方向"})
        )
        .unwrap_err()
        .contains("另存"));
    let second = f
        .request(
            "POST",
            &format!("/api/projects/{project}/plans"),
            json!({"summary":"留在故乡","sourcePlanId":plan_id,"select":true}),
        )
        .unwrap();
    assert_eq!(second["plan"]["status"], "active");
    assert_eq!(
        f.request(
            "GET",
            &format!("/api/projects/{project}/plans/{plan_id}"),
            Value::Null
        )
        .unwrap()["plan"]["status"],
        "draft"
    );
    let draft_id = database::id();
    f.db.execute("INSERT INTO DraftChapter(id,projectId,planId,\"index\",title,content,outlineItemJson,version,continuityCheckJson,memoryUpdateStatus,createdAt,updatedAt) VALUES(?,?,?,1,'北境','旧正文','{}',1,'{}','proposed',?,?)",
        rusqlite::params![draft_id,project,plan_id,database::now(),database::now()]).unwrap();
    let proposal_id = database::id();
    f.db.execute("INSERT INTO MemoryProposal(id,projectId,draftId,kind,category,content,status,createdAt,updatedAt) VALUES(?,?,?,'add','summary','旧提案','inferred',?,?)",
        rusqlite::params![proposal_id,project,draft_id,database::now(),database::now()]).unwrap();
    let edited = f
        .request(
            "PATCH",
            &format!("/api/projects/{project}/drafts/{draft_id}"),
            json!({"title":"北境新章","content":"作者新正文"}),
        )
        .unwrap();
    assert_eq!(edited["draft"]["version"], 2);
    assert_eq!(edited["draft"]["memoryUpdateStatus"], "none");
    assert_eq!(
        f.request(
            "GET",
            &format!("/api/projects/{project}/proposals"),
            Value::Null
        )
        .unwrap()["proposals"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    let issue_id = database::id();
    f.db.execute("INSERT INTO ContinuityIssue(id,projectId,draftId,category,severity,description,evidenceJson,status,createdAt,updatedAt) VALUES(?,?,?,'设定','warning','时间不符','[]','open',?,?)",
        rusqlite::params![issue_id,project,draft_id,database::now(),database::now()]).unwrap();
    let issue = f
        .request(
            "PATCH",
            &format!("/api/projects/{project}/issues/{issue_id}"),
            json!({"status":"resolved"}),
        )
        .unwrap();
    assert_eq!(issue["issue"]["status"], "resolved");
    f.request(
        "DELETE",
        &format!("/api/projects/{project}/plans/{plan_id}"),
        Value::Null,
    )
    .unwrap();
    assert!(f
        .request(
            "GET",
            &format!("/api/projects/{project}/drafts/{draft_id}"),
            Value::Null
        )
        .is_err());
    assert!(f
        .request(
            "GET",
            &format!("/api/projects/{project}/issues/{issue_id}"),
            Value::Null
        )
        .is_err());
}

#[test]
fn direction_and_outline_tasks_write_reviewable_plans() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::{Duration, Instant};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let outputs = [
            json!({"candidates":[{"direction":"向北追寻","summary":"追查失踪者","relatedThreads":["失踪"]},
                {"direction":"留守故乡","summary":"守护家园","relatedThreads":[]}]}),
            json!({"chapters":[{"title":"出发","summary":"启程北上","beats":["告别"],"relatedThreads":["失踪"]},
                {"title":"山口","summary":"抵达山口","beats":["遭遇暴雪"],"relatedThreads":[]}],
                "notes":"","conflicts":[]}),
        ];
        for output in outputs {
            let (mut stream, _) = listener.accept().unwrap();
            let mut input = [0u8; 8192];
            let _ = stream.read(&mut input);
            let payload=json!({"choices":[{"message":{"content":output.to_string()}}],"usage":{"total_tokens":40}}).to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",payload.len(),payload).unwrap();
        }
    });
    let mut f = Fixture::new();
    let project = f.create();
    f.import(&project, "他在故乡寻找失踪的人。");
    f.request("POST",&format!("/api/projects/{project}/memory"),
        json!({"category":"thread","key":"missing","title":"失踪","content":"有人失踪","status":"open","citations":[]})).unwrap();
    let profile = f
        .request(
            "POST",
            "/api/model-profiles",
            json!({"name":"Mock","provider":"ollama",
        "model":"mock","baseUrl":format!("http://{address}/v1"),"isLocal":true}),
        )
        .unwrap()["profile"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let wait_run = |f: &mut Fixture, run_id: &str| {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let run = f
                .request("GET", &format!("/api/analysis/{run_id}"), Value::Null)
                .unwrap()["run"]
                .clone();
            if run["status"] == "done" {
                return run;
            }
            if run["status"] == "failed" {
                panic!("task failed: {}", run["error"]);
            }
            assert!(Instant::now() < deadline, "task timed out");
            std::thread::sleep(Duration::from_millis(30));
        }
    };
    let direction = f
        .request(
            "POST",
            &format!("/api/projects/{project}/analysis"),
            json!({"taskType":"direction","profileId":profile}),
        )
        .unwrap()["runId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(wait_run(&mut f, &direction)["progress"]["produced"], 2);
    let plans = f
        .request(
            "GET",
            &format!("/api/projects/{project}/plans"),
            Value::Null,
        )
        .unwrap()["plans"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(plans.len(), 2);
    let plan_id = plans[0]["id"].as_str().unwrap();
    f.request(
        "POST",
        &format!("/api/projects/{project}/plans/{plan_id}/activate"),
        Value::Null,
    )
    .unwrap();
    let outline=f.request("POST",&format!("/api/projects/{project}/analysis"),
        json!({"taskType":"outline","profileId":profile,"payload":{"planId":plan_id,"outlineCount":2}})).unwrap()["runId"].as_str().unwrap().to_string();
    assert_eq!(wait_run(&mut f, &outline)["progress"]["produced"], 2);
    let saved = f
        .request(
            "GET",
            &format!("/api/projects/{project}/plans/{plan_id}"),
            Value::Null,
        )
        .unwrap();
    assert_eq!(saved["plan"]["outline"].as_array().unwrap().len(), 2);
    assert_eq!(saved["plan"]["version"], 2);
    server.join().unwrap();
}

#[test]
fn draft_workflow_checks_continuity_extracts_memory_and_preserves_author_edits() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::{Duration, Instant};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let outputs = [
            json!({"title":"重返旧城","content":"他沿着熟悉的街道缓缓前行，旧城的石墙仍带着雨后的凉意。远处钟声响起，提醒他十年前的线索还没有结束。他停在城门前，决定先去寻找当年的目击者。".repeat(30)}),
            json!({"issues":[{"category":"设定","severity":"warning","description":"城门状态需核对","draftExcerpts":["他停在城门前"],"memoryRefs":["M1"]}]}),
            json!({"items":[{"category":"chapter-note","key":"","title":"","content":"主角寻找目击者"}]}),
        ];
        for output in outputs {
            let (mut stream, _) = listener.accept().unwrap();
            let mut input = [0u8; 16384];
            let _ = stream.read(&mut input);
            let content = output.to_string();
            let payload =
                json!({"choices":[{"message":{"content":content}}],"usage":{"total_tokens":80}})
                    .to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",payload.len(),payload).unwrap();
        }
    });
    let mut f = Fixture::new();
    let project = f.create();
    f.import(&project, "他回到旧城。");
    f.request("POST",&format!("/api/projects/{project}/memory"),
        json!({"category":"character","key":"hero","title":"主角","content":"已回旧城","status":"confirmed","citations":[]})).unwrap();
    let plan_id = f
        .request(
            "POST",
            &format!("/api/projects/{project}/plans"),
            json!({"direction":"追查旧案","summary":"从旧城城门开始追查。","select":true}),
        )
        .unwrap()["plan"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    f.request("PATCH",&format!("/api/projects/{project}/plans/{plan_id}"),
        json!({"outline":[{"title":"重返旧城","summary":"主角寻找目击者","beats":["到城门"],"relatedThreads":[]}]})).unwrap();
    let profile = f
        .request(
            "POST",
            "/api/model-profiles",
            json!({"name":"Mock","provider":"ollama",
        "model":"mock","baseUrl":format!("http://{address}/v1"),"isLocal":true}),
        )
        .unwrap()["profile"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let args = json!({"taskType":"draft","profileId":profile,"payload":{"planId":plan_id}});
    assert_eq!(
        f.request(
            "POST",
            &format!("/api/projects/{project}/analysis/preview"),
            args.clone()
        )
        .unwrap()["preview"]["unitCount"],
        1
    );
    let run_id = f
        .request("POST", &format!("/api/projects/{project}/analysis"), args)
        .unwrap()["runId"]
        .as_str()
        .unwrap()
        .to_string();
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let run = f
            .request("GET", &format!("/api/analysis/{run_id}"), Value::Null)
            .unwrap()["run"]
            .clone();
        if run["status"] == "done" {
            assert_eq!(run["progress"]["produced"], 1);
            break;
        }
        if run["status"] == "failed" {
            panic!("draft failed: {}", run["error"]);
        }
        assert!(Instant::now() < deadline, "draft timed out");
        std::thread::sleep(Duration::from_millis(30));
    }
    let drafts = f
        .request(
            "GET",
            &format!("/api/projects/{project}/plans/{plan_id}/drafts"),
            Value::Null,
        )
        .unwrap();
    let draft_id = drafts["drafts"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(drafts["drafts"][0]["outlineItem"]["index"], 1);
    assert!(drafts["drafts"][0]["content"]
        .as_str()
        .unwrap()
        .contains("目击者"));
    for task in ["continuity-check", "draft-memory"] {
        let run_id=f.request("POST",&format!("/api/projects/{project}/analysis"),
            json!({"taskType":task,"profileId":profile,"payload":{"planId":plan_id,"draftId":draft_id}}))
            .unwrap()["runId"].as_str().unwrap().to_string();
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let run = f
                .request("GET", &format!("/api/analysis/{run_id}"), Value::Null)
                .unwrap()["run"]
                .clone();
            if run["status"] == "done" {
                assert_eq!(run["progress"]["produced"], 1);
                break;
            }
            if run["status"] == "failed" {
                panic!("task failed: {}", run["error"]);
            }
            assert!(Instant::now() < deadline, "task timed out");
            std::thread::sleep(Duration::from_millis(30));
        }
    }
    server.join().unwrap();
    let issues = f
        .request(
            "GET",
            &format!("/api/projects/{project}/issues?draftId={draft_id}"),
            Value::Null,
        )
        .unwrap();
    assert_eq!(
        issues["issues"][0]["evidence"][0]["excerpt"],
        "他停在城门前"
    );
    assert!(issues["issues"][0]["evidence"][0]["startOffset"]
        .as_u64()
        .is_some());
    assert_eq!(issues["issues"][0]["evidence"][1]["kind"], "memory");
    let proposals = f
        .request(
            "GET",
            &format!("/api/projects/{project}/proposals"),
            Value::Null,
        )
        .unwrap();
    assert_eq!(proposals["proposals"][0]["draftId"], draft_id);
    let proposal_id = proposals["proposals"][0]["id"].as_str().unwrap();
    f.request(
        "POST",
        &format!("/api/proposals/{proposal_id}/accept"),
        Value::Null,
    )
    .unwrap();
    assert_eq!(
        f.request(
            "GET",
            &format!("/api/projects/{project}/drafts/{draft_id}"),
            Value::Null
        )
        .unwrap()["draft"]["memoryUpdateStatus"],
        "applied"
    );
    let edited = f
        .request(
            "PATCH",
            &format!("/api/projects/{project}/drafts/{draft_id}"),
            json!({"content":"作者改写了这一章的正文。"}),
        )
        .unwrap();
    assert_eq!(edited["draft"]["version"], 2);
    assert_eq!(edited["draft"]["content"], "作者改写了这一章的正文。");
    assert!(edited["draft"]["continuityCheckedAt"].is_null());
    assert!(f
        .request(
            "GET",
            &format!("/api/projects/{project}/issues"),
            Value::Null
        )
        .unwrap()["issues"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn memory_versions_restore_conflicts_and_citation_scope() {
    let mut f = Fixture::new();
    let project = f.create();
    let other = f.create();
    f.import(&project, "甲😀乙丙");
    f.import(&other, "异项目正文");
    let chapter = f.chapters(&project)[0]["id"].as_str().unwrap().to_string();
    let foreign = f.chapters(&other)[0]["id"].as_str().unwrap().to_string();
    let path = format!("/api/projects/{project}/memory");
    let mut body = json!({"category":"character","key":"hero","title":"主角","content":"住在城里","status":"confirmed","citations":[{"chapterId":chapter,"startOffset":1,"endOffset":3,"excerpt":"😀"}]});
    let created = f.request("POST", &path, body.clone()).unwrap();
    let first_id = created["entry"]["id"].as_str().unwrap().to_string();
    assert_eq!(created["entry"]["citations"][0]["chapterIndex"], 1);
    body["content"] = json!("搬到山里");
    let second = f
        .request("PATCH", &format!("/api/memory/{first_id}"), body.clone())
        .unwrap();
    let second_id = second["entry"]["id"].as_str().unwrap().to_string();
    assert_eq!(second["entry"]["revision"], 2);
    assert!(second["entry"]["isUserEdited"].as_bool().unwrap());
    let history = f
        .request(
            "GET",
            &format!("/api/memory/{first_id}/history"),
            Value::Null,
        )
        .unwrap();
    assert_eq!(history["history"].as_array().unwrap().len(), 2);
    assert_eq!(history["history"][0]["id"], second_id);
    assert_eq!(history["history"][1]["content"], "住在城里");
    let restored = f
        .request(
            "POST",
            &format!("/api/memory/{first_id}/history"),
            json!({"revision":1}),
        )
        .unwrap();
    assert_eq!(restored["entry"]["revision"], 3);
    assert_eq!(restored["entry"]["content"], "住在城里");
    assert_eq!(
        f.request("GET", &path, Value::Null).unwrap()["entries"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    f.request("POST", &path, body.clone()).unwrap();
    let list = f.request("GET", &path, Value::Null).unwrap();
    assert_eq!(list["conflicts"].as_array().unwrap().len(), 1);
    assert_eq!(list["counts"]["character"], 2);
    assert_eq!(
        f.request("GET", &format!("{path}?q=%E6%90%AC%E5%88%B0"), Value::Null)
            .unwrap()["entries"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    body["citations"][0]["chapterId"] = json!(foreign);
    assert!(f
        .request("PATCH", &format!("/api/memory/{second_id}"), body)
        .is_err());
    let export = f
        .request("GET", &format!("{path}/export"), Value::Null)
        .unwrap();
    assert!(export["text"].as_str().unwrap().contains("第 1 章"));
    f.request("DELETE", &format!("/api/memory/{first_id}"), Value::Null)
        .unwrap();
    assert_eq!(
        f.request("GET", &path, Value::Null).unwrap()["entries"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn memory_import_deduplicates_and_rolls_back_bad_file() {
    let mut f = Fixture::new();
    let project = f.create();
    let path = format!("/api/projects/{project}/memory/import");
    let row = json!({"category":"story-bible","key":"setting:city","title":"城池","content":"北方城池","status":"confirmed","citations":[]});
    let file = json!({"fileName":"设定集.md","kind":"story-bible","warnings":[],"entries":[row],"knowledge":[{"characterName":"甲","infoItem":"知道城门","relation":"known"}]});
    let first = f
        .request("POST", &path, json!({"files":[file.clone()]}))
        .unwrap();
    assert_eq!(first["summary"]["totals"]["imported"], 1);
    assert_eq!(first["summary"]["totals"]["knowledge"], 1);
    let again = f.request("POST", &path, json!({"files":[file]})).unwrap();
    assert_eq!(again["summary"]["totals"]["skipped"], 1);
    assert_eq!(again["summary"]["totals"]["knowledge"], 0);
    let bad = json!({"fileName":"坏文件.md","kind":"story-bible","warnings":[],"entries":[
        {"category":"story-bible","key":"valid","content":"有效","status":"confirmed","citations":[]},
        {"category":"story-bible","key":"bad","content":"无效状态","status":"open","citations":[]}
    ],"knowledge":[]});
    let outcome = f.request("POST", &path, json!({"files":[bad]})).unwrap();
    assert!(outcome["summary"]["files"][0]["error"].as_str().is_some());
    let list = f
        .request(
            "GET",
            &format!("/api/projects/{project}/memory"),
            Value::Null,
        )
        .unwrap();
    assert_eq!(list["entries"].as_array().unwrap().len(), 1);
    let knowledge = f
        .request(
            "GET",
            &format!("/api/projects/{project}/knowledge"),
            Value::Null,
        )
        .unwrap();
    let item_id = knowledge["knowledge"][0]["id"].as_str().unwrap();
    let changed = f
        .request(
            "PATCH",
            &format!("/api/knowledge/{item_id}"),
            json!({"characterName":"甲","infoItem":"误信城门关闭","relation":"misbelieved"}),
        )
        .unwrap();
    assert_eq!(changed["item"]["relation"], "misbelieved");
    f.request("DELETE", &format!("/api/knowledge/{item_id}"), Value::Null)
        .unwrap();
    assert!(f
        .request(
            "GET",
            &format!("/api/projects/{project}/knowledge"),
            Value::Null
        )
        .unwrap()["knowledge"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn model_profiles_encrypt_keys_and_preserve_defaults() {
    let mut f = Fixture::new();
    let empty = f
        .request("GET", "/api/model-profiles", Value::Null)
        .unwrap();
    assert_eq!(empty["encryptionReady"], true);
    let path = "/api/model-profiles";
    let cloud=f.request("POST",path,json!({"name":"云端测试","provider":"openai-compatible","model":"test-model","baseUrl":"https://example.invalid/v1","apiKey":"synthetic-secret-1234","isLocal":false})).unwrap();
    let cloud_id = cloud["profile"]["id"].as_str().unwrap().to_string();
    assert_eq!(cloud["profile"]["isDefault"], true);
    assert_eq!(cloud["profile"]["maskedKey"], "••••••1234");
    assert!(!cloud.to_string().contains("synthetic-secret-1234"));
    let encrypted = database::one(
        &f.db,
        "SELECT apiKeyEncrypted FROM ModelProfile WHERE id=?",
        &[json!(cloud_id)],
    )
    .unwrap();
    let stored = encrypted["apiKeyEncrypted"].as_str().unwrap();
    assert!(!stored.contains("synthetic-secret-1234"));
    let key = changyi_desktop::secrets::read_key(f.dir.path())
        .unwrap()
        .unwrap();
    assert_eq!(
        changyi_desktop::secrets::decrypt(&key, stored).unwrap(),
        "synthetic-secret-1234"
    );
    let local = f
        .request(
            "POST",
            path,
            json!({"name":"本地测试","provider":"ollama","model":"local","isLocal":true}),
        )
        .unwrap();
    let local_id = local["profile"]["id"].as_str().unwrap().to_string();
    assert_eq!(local["profile"]["hasKey"], false);
    f.request("POST", &format!("{path}/{local_id}/default"), Value::Null)
        .unwrap();
    let listed = f.request("GET", path, Value::Null).unwrap();
    assert_eq!(listed["profiles"][0]["id"], local_id);
    assert_eq!(listed["profiles"][0]["isDefault"], true);
    f.request(
        "PATCH",
        &format!("{path}/{cloud_id}"),
        json!({"name":"已更新","model":"test-model-2","isLocal":false}),
    )
    .unwrap();
    let updated = f.request("GET", path, Value::Null).unwrap();
    assert_eq!(updated["profiles"][1]["maskedKey"], "••••••1234");
    f.request("DELETE", &format!("{path}/{local_id}"), Value::Null)
        .unwrap();
    let final_list = f.request("GET", path, Value::Null).unwrap();
    assert_eq!(final_list["profiles"][0]["id"], cloud_id);
    assert_eq!(final_list["profiles"][0]["isDefault"], true);
}

#[test]
fn legacy_node_ciphertext_and_env_key_survive_workspace_copy() {
    let source = tempfile::tempdir().unwrap();
    let folder = source.path().join("original");
    let db = database::open(&folder).unwrap();
    let ciphertext = r#"{"v":1,"iv":"CQkJCQkJCQkJCQkJ","tag":"IDhlamIPQGzTqSbAE7WaQQ==","ct":"VO6p4NuDtUxG9WzdSWxKTXE="}"#;
    let expected_key = "0707070707070707070707070707070707070707070707070707070707070707";
    database::execute(&db,"INSERT INTO ModelProfile(id,name,provider,model,apiKeyEncrypted,isLocal,isDefault,taskUsageJson,createdAt,updatedAt) VALUES(?,?,?,?,?,0,1,'{}',?,?)",
        &[json!("legacy"),json!("旧档案"),json!("openai-compatible"),json!("old-model"),json!(ciphertext),json!(database::now()),json!(database::now())]).unwrap();
    let target = source.path().join("copy");
    std::fs::create_dir_all(&target).unwrap();
    assert!(changyi_desktop::secrets::prepare_copy(&folder, &target, &db).is_err());
    std::fs::write(
        source.path().join(".env"),
        format!("APP_ENCRYPTION_KEY=\"{expected_key}\"\n"),
    )
    .unwrap();
    changyi_desktop::secrets::prepare_copy(&folder, &target, &db).unwrap();
    let key = changyi_desktop::secrets::read_key(&target)
        .unwrap()
        .unwrap();
    assert_eq!(
        changyi_desktop::secrets::decrypt(&key, ciphertext).unwrap(),
        "sk-test-旧密钥"
    );
    assert!(changyi_desktop::secrets::restore_key(&target, &db, &"00".repeat(32)).is_err());
}

#[test]
fn project_import_read_split_merge_use_utf16_offsets() {
    let mut f = Fixture::new();
    let p = f.create();
    f.import(&p, "甲😀乙丙");
    let rows = f.chapters(&p);
    let chapter = rows[0]["id"].as_str().unwrap();
    assert!(rows[0].get("content").is_none());
    assert_eq!(rows[0]["charCount"], 5);
    let failed = f.request(
        "POST",
        &format!("/api/chapters/{chapter}/split"),
        json!({"atOffset":2}),
    );
    assert!(failed.is_err());
    assert_eq!(f.chapters(&p).len(), 1);
    f.request(
        "POST",
        &format!("/api/chapters/{chapter}/split"),
        json!({"atOffset":3}),
    )
    .unwrap();
    let rows = f.chapters(&p);
    assert_eq!(rows.len(), 2);
    let head = f
        .request("GET", &format!("/api/chapters/{chapter}"), Value::Null)
        .unwrap();
    assert_eq!(head["chapter"]["content"], "甲😀");
    f.request(
        "POST",
        &format!("/api/chapters/{chapter}/merge"),
        json!({"nextId":rows[1]["id"]}),
    )
    .unwrap();
    assert_eq!(f.chapters(&p).len(), 1);
    let exported = f
        .request(
            "GET",
            &format!("/api/projects/{p}/export?format=txt"),
            Value::Null,
        )
        .unwrap();
    assert!(exported["text"].as_str().unwrap().contains("甲😀\n\n乙丙"));
}

#[test]
fn reject_duplicate_reorder_and_cross_project_merge() {
    let mut f = Fixture::new();
    let p = f.create();
    f.import(&p, "甲乙丙丁");
    let first = f.chapters(&p)[0]["id"].as_str().unwrap().to_string();
    f.request(
        "POST",
        &format!("/api/chapters/{first}/split"),
        json!({"atOffset":2}),
    )
    .unwrap();
    let before = f.chapters(&p);
    assert!(f
        .request(
            "POST",
            &format!("/api/projects/{p}/chapters/reorder"),
            json!({"orderedIds":[first,first]})
        )
        .is_err());
    assert_eq!(before, f.chapters(&p));
    let q = f.create();
    f.import(&q, "其他项目正文");
    let other = f.chapters(&q)[0]["id"].clone();
    assert!(f
        .request(
            "POST",
            &format!("/api/chapters/{first}/merge"),
            json!({"nextId":other})
        )
        .is_err());
    assert_eq!(before, f.chapters(&p));
}

#[test]
fn failed_reimport_rolls_back_database_and_new_source() {
    let mut f = Fixture::new();
    let p = f.create();
    f.import(&p, "原有正文");
    let original = f.chapters(&p);
    let source = database::one(
        &f.db,
        "SELECT storedPath FROM SourceDocument WHERE projectId=?",
        &[json!(p)],
    )
    .unwrap();
    let path = f.dir.path().join(source["storedPath"].as_str().unwrap());
    let bytes = fs::read(&path).unwrap();
    let mut body = import_body("替换正文");
    body["chapters"][0]["normalizedIndex"] = Value::Null;
    assert!(f
        .request("POST", &format!("/api/projects/{p}/import"), body)
        .is_err());
    assert_eq!(f.chapters(&p), original);
    assert_eq!(fs::read(path).unwrap(), bytes);
    assert_eq!(
        fs::read_dir(f.dir.path().join(format!("projects/{p}/sources")))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn active_run_blocks_reimport() {
    let mut f = Fixture::new();
    let p = f.create();
    f.import(&p, "原有正文");
    database::execute(&f.db,"INSERT INTO AnalysisRun(id,projectId,taskType,status,updatedAt) VALUES('run',?,'chapter-extract','running',?)",&[json!(p),json!(database::now())]).unwrap();
    assert!(f
        .request(
            "POST",
            &format!("/api/projects/{p}/import"),
            import_body("替换正文")
        )
        .unwrap_err()
        .contains("运行中"));
}

fn backup() -> Value {
    json!({
        "app":"novel-continuation","exportVersion":2,"project":{"name":"恢复样例","language":"zh"},
        "chapters":[{"id":"ch-old","rawTitle":"第一章","content":"旧章节😀","normalizedIndex":1,"sortOrder":1}],
        "memoryEntries":[{"id":"m-old","category":"character","content":"人物记忆","citations":[{"chapterId":"ch-old","excerpt":"旧章节"},{"chapterId":"missing"}]}],
        "characterKnowledge":[{"characterName":"主角","infoItem":"事实","relation":"known"}],
        "continuationPlans":[{"id":"p-old","direction":"继续调查","summary":"保持作者的完整要求","outline":[{"index":1}]}],
        "draftChapters":[{"id":"d-old","planId":"p-old","index":1,"content":"草稿内容","continuityCheck":{"status":"done"}}],
        "continuityIssues":[{"draftId":"d-old","category":"时间线","description":"需要核对","evidence":[{"kind":"chapter","chapterId":"ch-old"},{"kind":"memory","entryId":"m-old"},{"kind":"draft","draftId":"d-old"}]}],
        "memoryProposals":[{"chapterId":"ch-old","draftId":"d-old","targetEntryId":"m-old","kind":"update","category":"character","content":"提案","citations":[{"chapterId":"ch-old"}]}]
    })
}

#[test]
fn restore_and_export_preserve_links_and_exclude_profiles() {
    let mut f = Fixture::new();
    let restored = f
        .request("POST", "/api/projects/restore", backup())
        .unwrap();
    assert_eq!(restored["summary"]["droppedCitations"], 1);
    let p = restored["project"]["id"].as_str().unwrap();
    database::execute(&f.db,"INSERT INTO ModelProfile(id,name,provider,model,apiKeyEncrypted,updatedAt) VALUES('profile','模型','openai-compatible','test','private-key-sentinel',?)",&[json!(database::now())]).unwrap();
    let exported = f
        .request(
            "GET",
            &format!("/api/projects/{p}/export?format=json"),
            Value::Null,
        )
        .unwrap();
    let raw = exported["text"].as_str().unwrap();
    assert!(!raw.contains("private-key-sentinel"));
    assert!(!raw.contains("ModelProfile"));
    let snapshot: Value = serde_json::from_str(raw).unwrap();
    assert_eq!(snapshot["backupScope"]["kind"], "project");
    assert!(snapshot["backupScope"]["excludes"].as_array().unwrap().contains(&json!("works")));
    assert_ne!(snapshot["chapters"][0]["id"], "ch-old");
    assert_eq!(
        snapshot["memoryEntries"][0]["citations"][0]["chapterId"],
        snapshot["chapters"][0]["id"]
    );
    assert_eq!(
        snapshot["draftChapters"][0]["planId"],
        snapshot["continuationPlans"][0]["id"]
    );
    assert_eq!(
        snapshot["memoryProposals"][0]["draftId"],
        snapshot["draftChapters"][0]["id"]
    );
    assert_eq!(
        snapshot["continuityIssues"][0]["evidence"][1]["entryId"],
        snapshot["memoryEntries"][0]["id"]
    );
    let second = f
        .request("POST", "/api/projects/restore", snapshot)
        .unwrap();
    assert_ne!(second["project"]["id"], json!(p));
    assert_eq!(second["summary"]["droppedCitations"], 0);
}

#[test]
fn invalid_backup_does_not_leave_partial_project_or_files() {
    let mut f = Fixture::new();
    let mut input = backup();
    input["chapters"][0]["startOffset"] = json!(-1);
    assert!(f.request("POST", "/api/projects/restore", input).is_err());
    assert!(
        f.request("GET", "/api/projects", Value::Null).unwrap()["projects"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let projects = f.dir.path().join("projects");
    assert!(!projects.exists() || fs::read_dir(projects).unwrap().next().is_none());
}

#[test]
fn snapshot_includes_committed_wal_and_does_not_update_source_records() {
    let mut f = Fixture::new();
    f.db.execute_batch("PRAGMA journal_mode=WAL").unwrap();
    let p = f.create();
    f.import(&p, "快照正文");
    let dest = tempfile::tempdir().unwrap();
    database::snapshot(&f.dir.path().join("app.db"), &dest.path().join("app.db")).unwrap();
    let copy = database::open(dest.path()).unwrap();
    assert_eq!(
        database::one(
            &copy,
            "SELECT name FROM NovelProject WHERE id=?",
            &[json!(p)]
        )
        .unwrap()["name"],
        "测试小说"
    );
    assert_eq!(
        database::query(&copy, "PRAGMA foreign_key_check", &[])
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        database::one(
            &f.db,
            "SELECT content FROM Chapter WHERE projectId=?",
            &[json!(p)]
        )
        .unwrap()["content"],
        "快照正文"
    );
}

#[test]
fn existing_prisma_schema_is_accepted_without_rebuilding_it() {
    let dir = tempfile::tempdir().unwrap();
    let db = Connection::open(dir.path().join("app.db")).unwrap();
    for migration in [
        include_str!("fixtures/legacy-schema/20261014070954_init.sql"),
        include_str!(
            "fixtures/legacy-schema/20261015045343_analysis_pipeline.sql"
        ),
        include_str!(
            "fixtures/legacy-schema/20261015055759_continuity_issue_draft.sql"
        ),
        include_str!(
            "fixtures/legacy-schema/20261015060705_memory_proposal_draft.sql"
        ),
    ] {
        db.execute_batch(migration).unwrap();
    }
    db.execute("INSERT INTO NovelProject(id,name,createdAt,updatedAt) VALUES('old','旧项目',1720000000000,1720000000000)",[]).unwrap();
    drop(db);
    let old = Connection::open(dir.path().join("app.db")).unwrap();
    let schema = database::query(
        &old,
        "SELECT name,sql FROM sqlite_master ORDER BY name",
        &[],
    )
    .unwrap();
    drop(old);
    let db = database::open(dir.path()).unwrap();
    for original in schema {
        assert_eq!(
            database::one(
                &db,
                "SELECT name,sql FROM sqlite_master WHERE name=?",
                &[original["name"].clone()]
            )
            .unwrap(),
            original
        );
    }
    assert_eq!(
        database::one(&db, "SELECT name FROM NovelProject WHERE id='old'", &[]).unwrap()["name"],
        "旧项目"
    );
    assert_eq!(
        database::one(&db, "SELECT * FROM NovelProject", &[]).unwrap()["createdAt"],
        "2024-07-03T09:46:40.000Z"
    );
    drop(db);
    let migrated = fs::read(dir.path().join("app.db")).unwrap();
    drop(database::open(dir.path()).unwrap());
    assert!(
        fs::read(dir.path().join("app.db")).unwrap() == migrated,
        "reopening must be idempotent"
    );
}

#[test]
fn reject_unsafe_paths_and_unknown_api() {
    let mut f = Fixture::new();
    for path in [
        "../outside",
        "projects/../../outside",
        "C:/outside",
        "projects\\outside",
        "/outside",
    ] {
        assert!(database::safe_path(f.dir.path(), path).is_err(), "{path}");
    }
    assert!(f
        .request("POST", "/api/sql", json!({"sql":"DROP TABLE NovelProject"}))
        .is_err());
}

fn automation_mock(outputs: Vec<Value>) -> (String, std::thread::JoinHandle<Vec<String>>) {
    automation_mock_with_hook(outputs, |_| {})
}
fn automation_mock_with_hook(
    outputs: Vec<Value>,
    mut hook: impl FnMut(usize) + Send + 'static,
) -> (String, std::thread::JoinHandle<Vec<String>>) {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        time::{Duration, Instant},
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = format!("http://{}/v1", listener.local_addr().unwrap());
    let handle = std::thread::spawn(move || {
        let mut requests = vec![];
        for output in outputs {
            let deadline = Instant::now() + Duration::from_secs(15);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "missing model request");
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(e) => panic!("{e}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = vec![];
            loop {
                let mut chunk = [0u8; 8192];
                let size = stream.read(&mut chunk).unwrap();
                if size == 0 {
                    break;
                }
                bytes.extend_from_slice(&chunk[..size]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]);
                    let length = header
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|v| v.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            requests.push(String::from_utf8_lossy(&bytes).into_owned());
            hook(requests.len());
            let payload =
                json!({"choices":[{"message":{"content":output.to_string()}}]}).to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",payload.len(),payload).unwrap();
        }
        requests
    });
    (address, handle)
}
fn automation_profile(f: &mut Fixture, address: &str) -> String {
    f.request("POST","/api/model-profiles",json!({"name":"自动流程测试","provider":"ollama","model":"mock","baseUrl":address,"isLocal":true})).unwrap()["profile"]["id"].as_str().unwrap().into()
}
fn wait_workflow(f: &mut Fixture, id: &str, expected: &str) -> Value {
    use std::time::{Duration, Instant};
    let deadline = Instant::now() + Duration::from_secs(12);
    loop {
        let rows = f.request("GET", "/api/workflows", Value::Null).unwrap();
        let row = rows["workflows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["id"] == id)
            .unwrap()
            .clone();
        if row["status"] == expected {
            return row;
        }
        assert!(
            row["status"] != "failed" || expected == "failed",
            "workflow failed: {}",
            row["error"]
        );
        assert!(Instant::now() < deadline, "workflow timeout: {row}");
        std::thread::sleep(Duration::from_millis(20));
    }
}
fn automation_outline() -> Value {
    json!({"chapters":[{"title":"启程","summary":"主角出发","beats":[],"relatedThreads":[]},{"title":"归来","summary":"主角归来","beats":[],"relatedThreads":[]}],"notes":"","conflicts":[]})
}
fn automation_draft(title: &str) -> Value {
    json!({"title":title,"content":"主角沿着故乡的石板路向前走，远处的钟声在山间回荡。他记得临行前的约定，决定先找到旧日的同伴，再一同查明事情的经过。眼前的街巷安静如常，新的旅程从这里开始。".repeat(30)})
}

#[test]
fn automatic_understanding_accepts_memory_then_synthesizes_with_one_overall_notice() {
    let (address, server) = automation_mock(vec![
        json!({"chapterNote":{"summary":"主角回到故乡。","excerpt":"回到故乡"},"events":[],"characters":[],"settings":[],"threads":[],"glossary":[]}),
        json!({"overview":"主角已归乡。","endingState":"抵达故乡。","unresolved":[],"constraints":[],"choices":[],"ambiguities":[]}),
    ]);
    let mut f = Fixture::new();
    let p = f.create();
    f.import(&p, "他回到故乡。");
    let settings = f
        .request("GET", "/api/settings/automation", Value::Null)
        .unwrap();
    assert_eq!(settings, json!({"autoAccept":true,"autoSynthesis":true}));
    let profile = automation_profile(&mut f, &address);
    let started = f
        .request(
            "POST",
            &format!("/api/projects/{p}/analysis"),
            json!({"taskType":"chapter-extract","profileId":profile}),
        )
        .unwrap();
    let workflow = started["workflowId"].as_str().unwrap();
    let done = wait_workflow(&mut f, workflow, "done");
    assert_eq!(done["step"], 2);
    let proposals = f
        .request("GET", &format!("/api/projects/{p}/proposals"), Value::Null)
        .unwrap();
    assert_eq!(proposals["counts"]["accepted"], 3);
    assert!(proposals["counts"]["pending"].is_null());
    let rows = f.request("GET", "/api/workflows", Value::Null).unwrap();
    assert_eq!(rows["workflows"].as_array().unwrap().len(), 1);
    f.request(
        "POST",
        &format!("/api/workflows/{workflow}/ack"),
        Value::Null,
    )
    .unwrap();
    assert_eq!(
        f.request("GET", "/api/workflows", Value::Null).unwrap()["workflows"][0]["notified"],
        1
    );
    let requests = server.join().unwrap();
    assert!(requests[1].contains("主角回到故乡"));
}

#[test]
fn automatic_continuation_retries_only_missing_work_and_keeps_draft_memory_pending() {
    let (address, server) = automation_mock(vec![
        automation_outline(),
        automation_draft("启程"),
        json!({"title":"归来","content":"过短"}),
        json!({"title":"归来","content":"仍然过短"}),
        automation_draft("归来"),
        json!({"issues":[]}),
        json!({"issues":[]}),
        json!({"items":[{"category":"chapter-note","key":"","title":"","content":"主角出发寻找同伴。"}]}),
        json!({"items":[{"category":"chapter-note","key":"","title":"","content":"主角和同伴归来。"}]}),
    ]);
    let mut f = Fixture::new();
    let p = f.create();
    f.import(&p, "他回到故乡。");
    f.request("POST",&format!("/api/projects/{p}/memory"),json!({"category":"character","key":"hero","title":"主角","content":"已回故乡","status":"confirmed","citations":[]})).unwrap();
    let plan = f
        .request(
            "POST",
            &format!("/api/projects/{p}/plans"),
            json!({"direction":"寻找同伴","summary":"主角出发寻找同伴"}),
        )
        .unwrap()["plan"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let profile = automation_profile(&mut f, &address);
    let started = f
        .request(
            "POST",
            &format!("/api/projects/{p}/workflows"),
            json!({"kind":"continue","profileId":profile,"planId":plan,"outlineCount":2}),
        )
        .unwrap();
    let workflow = started["workflowId"].as_str().unwrap();
    let failed = wait_workflow(&mut f, workflow, "failed");
    assert_eq!(failed["step"], 1, "{failed}");
    assert_eq!(failed["currentTask"], "draft");
    assert_eq!(failed["taskRuns"]["outline"]["status"], "done");
    assert_eq!(failed["taskRuns"]["draft"]["status"], "failed");
    assert_eq!(failed["plan"]["outline"].as_array().unwrap().len(), 2);
    assert_eq!(failed["plan"]["draftCount"], 1);
    let before = f
        .request(
            "GET",
            &format!("/api/projects/{p}/plans/{plan}/drafts"),
            Value::Null,
        )
        .unwrap();
    assert_eq!(before["drafts"].as_array().unwrap().len(), 1, "{failed}");
    f.request(
        "POST",
        &format!("/api/workflows/{workflow}/resume"),
        Value::Null,
    )
    .unwrap();
    let completed = wait_workflow(&mut f, workflow, "done");
    assert_eq!(completed["currentTask"], "draft-memory");
    assert_eq!(completed["taskRuns"].as_object().unwrap().len(), 4);
    assert!(completed["taskRuns"].as_object().unwrap().values().all(|run| run["status"] == "done"));
    assert_eq!(completed["plan"]["draftCount"], 2);
    let after = f
        .request(
            "GET",
            &format!("/api/projects/{p}/plans/{plan}/drafts"),
            Value::Null,
        )
        .unwrap();
    assert_eq!(after["drafts"].as_array().unwrap().len(), 2);
    assert_eq!(before["drafts"][0]["id"], after["drafts"][0]["id"]);
    assert_eq!(after["drafts"][0]["version"], 1);
    assert!(after["drafts"][0]["continuityCheckedAt"].is_string());
    assert_eq!(
        f.request("GET", &format!("/api/projects/{p}/proposals"), Value::Null)
            .unwrap()["counts"]["pending"],
        2
    );
    assert_eq!(
        database::query(
            &f.db,
            "SELECT id FROM MemoryEntry WHERE projectId=? AND isCurrent=1",
            &[json!(p)]
        )
        .unwrap()
        .len(),
        1
    );
    let archived = f.request("GET", "/api/works", Value::Null).unwrap();
    assert_eq!(archived["works"].as_array().unwrap().len(), 1);
    assert_eq!(archived["works"][0]["chapterCount"], 2);
    assert_eq!(archived["works"][0]["memoryCount"], 2);
    let work_id = archived["works"][0]["id"].as_str().unwrap();
    let original = f.request("GET", &format!("/api/projects/{p}/workspace"), Value::Null).unwrap();
    let original_path = f.dir.path().join(original["source"]["storedPath"].as_str().unwrap());
    let original_bytes = fs::read(&original_path).unwrap();
    assert!(f.request("POST", &format!("/api/works/{work_id}/merge"), Value::Null).is_err());
    f.request("DELETE", &format!("/api/projects/{p}/plans/{plan}"), Value::Null).unwrap();
    let merged = f.request("POST", &format!("/api/works/{work_id}/merge"), json!({"confirmed":true})).unwrap();
    assert_eq!(merged["merge"]["chapterCount"], 2);
    assert_eq!(merged["merge"]["memoryAdded"], 2);
    assert_eq!(merged["merge"]["memoryConflicts"], 0);
    let workspace = f.request("GET", &format!("/api/projects/{p}/workspace"), Value::Null).unwrap();
    assert_eq!(workspace["chapters"].as_array().unwrap().len(), 3);
    assert_eq!(workspace["chapters"][0]["id"], original["chapters"][0]["id"]);
    assert_eq!(fs::read(original_path).unwrap(), original_bytes);
    let memory = database::query(&f.db,"SELECT * FROM MemoryEntry WHERE projectId=? AND isCurrent=1", &[json!(p)]).unwrap();
    assert_eq!(memory.len(), 3);
    assert!(memory.iter().any(|row| row["content"] == "主角和同伴归来。"));
    let again = f.request("POST", &format!("/api/works/{work_id}/merge"), json!({"confirmed":true})).unwrap();
    assert_eq!(again["alreadyMerged"], true);
    assert_eq!(f.request("GET", &format!("/api/projects/{p}/chapters"), Value::Null).unwrap()["chapters"].as_array().unwrap().len(), 3);
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 9);
    assert!(requests[0].contains("接下来 2 章"));
}

fn merge_fixture() -> (Fixture, String, String, String) {
    let mut fixture = Fixture::new();
    let project = fixture.create();
    fixture.import(&project, "第一章 原作\n原作内容😀保持不变。");
    let hero = fixture.request("POST", &format!("/api/projects/{project}/memory"),json!({"category":"character","key":"hero","title":"主角","content":"作者保留的人设","status":"confirmed","citations":[]})).unwrap()["entry"]["id"].as_str().unwrap().to_string();
    let work = database::id();
    database::execute(&fixture.db,"INSERT INTO NativeWork(id,workflowId,title,sourceProjectId,sourceProjectName,direction,generatedAt) VALUES(?,?,?,?,?,?,?)", &[json!(work),json!(database::id()),json!("待并入作品"),json!(project),json!("测试小说"),json!("归来"),json!(database::now())]).unwrap();
    database::execute(&fixture.db,"INSERT INTO NativeWorkChapter(id,workId,\"index\",title,content) VALUES(?,?,1,'归来','新续写😀正文。')", &[json!(database::id()),json!(work)]).unwrap();
    for memory in [json!({"category":"chapter-note","key":null,"title":"归来记忆","content":"合并回滚验证","status":"inferred","state":"pending","targetEntryId":null}),json!({"category":"character","key":"hero","title":"主角","content":"模型更新人设","status":"inferred","state":"pending","targetEntryId":hero})] {
        database::execute(&fixture.db,"INSERT INTO NativeWorkMemory(id,workId,chapterIndex,sourceProposalId,payloadJson) VALUES(?,?,1,?,?)", &[json!(database::id()),json!(work),json!(database::id()),json!(memory.to_string())]).unwrap();
    }
    (fixture, project, work, hero)
}

#[test]
fn work_merge_is_atomic_preserves_manual_memory_and_uses_utf16_offsets() {
    let (mut f, project, work, hero) = merge_fixture();
    let sources = f.dir.path().join(format!("projects/{project}/sources"));
    let before_files = fs::read_dir(&sources).unwrap().count();
    f.db.execute_batch("CREATE TRIGGER reject_merged_memory BEFORE INSERT ON MemoryEntry WHEN NEW.content='合并回滚验证' BEGIN SELECT RAISE(ABORT,'模拟记忆写入失败'); END;").unwrap();
    assert!(f.request("POST",&format!("/api/works/{work}/merge"),json!({"confirmed":true})).is_err());
    assert_eq!(database::query(&f.db,"SELECT id FROM Chapter WHERE projectId=?", &[json!(project)]).unwrap().len(),1);
    assert_eq!(database::query(&f.db,"SELECT id FROM SourceDocument WHERE projectId=?", &[json!(project)]).unwrap().len(),1);
    assert!(database::query(&f.db,"SELECT * FROM NativeWorkMerge", &[]).unwrap().is_empty());
    assert_eq!(fs::read_dir(&sources).unwrap().count(),before_files);
    f.db.execute_batch("DROP TRIGGER reject_merged_memory").unwrap();
    let result = f.request("POST",&format!("/api/works/{work}/merge"),json!({"confirmed":true})).unwrap();
    assert_eq!(result["merge"]["memoryAdded"],1);
    assert_eq!(result["merge"]["memoryConflicts"],1);
    assert_eq!(database::one(&f.db,"SELECT content FROM MemoryEntry WHERE id=?", &[json!(hero)]).unwrap()["content"],"作者保留的人设");
    let chapter = database::one(&f.db,"SELECT * FROM Chapter WHERE projectId=? ORDER BY sortOrder DESC LIMIT 1", &[json!(project)]).unwrap();
    assert_eq!(chapter["normalizedIndex"],2);
    assert_eq!(chapter["rawTitle"],"第2章 归来");
    let source = database::one(&f.db,"SELECT storedPath FROM SourceDocument WHERE id=?", &[chapter["sourceDocumentId"].clone()]).unwrap();
    let text = fs::read_to_string(f.dir.path().join(source["storedPath"].as_str().unwrap())).unwrap();
    let utf16 = text.encode_utf16().collect::<Vec<_>>();
    assert_eq!(String::from_utf16(&utf16[chapter["startOffset"].as_u64().unwrap() as usize..chapter["endOffset"].as_u64().unwrap() as usize]).unwrap(),"新续写😀正文。");
    assert!(f.request("GET",&format!("/api/works/{work}"),Value::Null).unwrap()["work"]["mergedAt"].is_string());
}

#[test]
fn work_merge_requires_an_idle_existing_original() {
    let (mut f, project, work, _) = merge_fixture();
    let workflow = database::id();
    database::execute(&f.db,"INSERT INTO NativeWorkflow(id,projectId,kind,stepsJson,configJson,createdAt,updatedAt) VALUES(?,?,'continue','[]','{}',?,?)", &[json!(workflow),json!(project),json!(database::now()),json!(database::now())]).unwrap();
    assert!(f.request("POST",&format!("/api/works/{work}/merge"),json!({"confirmed":true})).unwrap_err().contains("任务运行"));
    database::execute(&f.db,"UPDATE NativeWorkflow SET status='canceled' WHERE id=?", &[json!(workflow)]).unwrap();
    f.request("DELETE",&format!("/api/projects/{project}"),Value::Null).unwrap();
    assert!(f.request("POST",&format!("/api/works/{work}/merge"),json!({"confirmed":true})).unwrap_err().contains("原作已删除"));
    assert_eq!(f.request("GET",&format!("/api/works/{work}"),Value::Null).unwrap()["work"]["chapters"][0]["content"],"新续写😀正文。");
}

#[test]
fn automatic_outline_recommends_length_from_the_direction() {
    let (address, server) = automation_mock(vec![json!({"chapters":[{"title":"归来","summary":"完成本段寻人目标","beats":[],"relatedThreads":[]}],"notes":"一个章节即可完成本段剧情","conflicts":[]}),automation_draft("归来"),json!({"issues":[]}),json!({"items":[]})]);
    let mut f = Fixture::new(); let project = f.create();
    f.import(&project,"原作内容。");
    f.request("POST",&format!("/api/projects/{project}/memory"),json!({"category":"chapter-note","content":"主角已出发。","status":"inferred","citations":[]})).unwrap();
    let plan = f.request("POST",&format!("/api/projects/{project}/plans"),json!({"direction":"找到同伴后结束本段剧情","summary":"简洁收束"})).unwrap()["plan"]["id"].as_str().unwrap().to_string();
    let profile = automation_profile(&mut f,&address);
    let started = f.request("POST",&format!("/api/projects/{project}/workflows"),json!({"kind":"continue","profileId":profile,"planId":plan,"outlineMode":"auto"})).unwrap();
    let finished = wait_workflow(&mut f,started["workflowId"].as_str().unwrap(),"done");
    assert_eq!(finished["plan"]["outline"].as_array().unwrap().len(),1);
    assert_eq!(finished["steps"][0]["payload"]["outlineMode"],"auto");
    let requests = server.join().unwrap();
    assert!(requests[0].contains("智能安排章数"));
    assert!(!requests[0].contains("接下来 5 章"));
}

#[test]
fn automatic_workflow_requires_cloud_authorization_and_protects_model_changes_on_resume() {
    let mut f = Fixture::new();
    let p = f.create();
    f.import(&p, "他回到故乡。");
    let profile=f.request("POST","/api/model-profiles",json!({"name":"远端","provider":"openai-compatible","model":"mock","baseUrl":"https://example.invalid/v1","apiKey":"test-key","isLocal":false})).unwrap()["profile"]["id"].as_str().unwrap().to_string();
    assert!(f
        .request(
            "POST",
            &format!("/api/projects/{p}/workflows"),
            json!({"kind":"understand","profileId":profile})
        )
        .unwrap_err()
        .contains("授权"));
    assert_eq!(
        database::query(&f.db, "SELECT id FROM NativeWorkflow", &[])
            .unwrap()
            .len(),
        0
    );
    database::execute(&f.db,"INSERT INTO NativeWorkflow(id,projectId,kind,status,stepsJson,configJson,createdAt,updatedAt) VALUES('interrupted',?,'understand','running','[]',?, ?, ?)",&[json!(p),json!(json!({"profileId":profile,"profile":{"model":"old"}}).to_string()),json!(database::now()),json!(database::now())]).unwrap();
    assert_eq!(
        f.request("GET", "/api/workflows", Value::Null).unwrap()["workflows"][0]["status"],
        "stalled"
    );
    assert!(f
        .request("POST", "/api/workflows/interrupted/resume", Value::Null)
        .unwrap_err()
        .contains("模型配置"));
    assert!(changyi_desktop::storage::ensure_idle(&f.db).is_err());
    f.request("POST", "/api/workflows/interrupted/cancel", Value::Null)
        .unwrap();
    assert!(changyi_desktop::storage::ensure_idle(&f.db).is_ok());
}

#[test]
fn automatic_acceptance_protects_author_edits_and_does_not_accept_older_proposals() {
    let (address, server) = automation_mock(vec![
        json!({"chapterNote":{"summary":"模型笔记。","excerpt":"回到故乡"},"events":[],"characters":[],"settings":[],"threads":[],"glossary":[]}),
    ]);
    let mut f = Fixture::new();
    let p = f.create();
    f.import(&p, "他回到故乡。");
    let chapter = f.chapters(&p)[0]["id"].as_str().unwrap().to_string();
    f.request(
        "PATCH",
        "/api/settings/automation",
        json!({"autoSynthesis":false}),
    )
    .unwrap();
    let entry=f.request("POST",&format!("/api/projects/{p}/memory"),json!({"category":"chapter-note","key":format!("ch:{chapter}"),"title":"作者笔记","content":"作者保留内容","status":"confirmed","citations":[]})).unwrap()["entry"]["id"].as_str().unwrap().to_string();
    database::execute(&f.db,"INSERT INTO MemoryProposal(id,projectId,kind,category,content,status,createdAt,updatedAt) VALUES('older',?,'add','summary','旧的待审阅提案','inferred',?,?)",&[json!(p),json!(database::now()),json!(database::now())]).unwrap();
    let profile = automation_profile(&mut f, &address);
    let run = f
        .request(
            "POST",
            &format!("/api/projects/{p}/analysis"),
            json!({"taskType":"chapter-extract","profileId":profile}),
        )
        .unwrap()["runId"]
        .as_str()
        .unwrap()
        .to_string();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    loop {
        let status = f
            .request("GET", &format!("/api/analysis/{run}"), Value::Null)
            .unwrap();
        if status["run"]["status"] == "done" {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "{status}");
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let rows = f
        .request("GET", &format!("/api/projects/{p}/proposals"), Value::Null)
        .unwrap();
    assert_eq!(rows["counts"]["conflicted"], 1);
    assert_eq!(rows["counts"]["pending"], 1);
    assert_eq!(
        f.request("GET", &format!("/api/memory/{entry}"), Value::Null)
            .unwrap()["entry"]["content"],
        "作者保留内容"
    );
    server.join().unwrap();
}

fn seed_finished_work(f: &mut Fixture) -> (String, String, String) {
    let p = f.create();
    f.import(&p, "原项目内容。");
    let plan = f
        .request(
            "POST",
            &format!("/api/projects/{p}/plans"),
            json!({"direction":"归乡","summary":"主角归乡"}),
        )
        .unwrap()["plan"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let draft = database::id();
    let workflow = database::id();
    database::execute(&f.db,"INSERT INTO DraftChapter(id,projectId,planId,\"index\",title,content,createdAt,updatedAt) VALUES(?,?,?,1,'归乡','已完成作品的独立正文',?,?)",&[json!(draft),json!(p),json!(plan),json!(database::now()),json!(database::now())]).unwrap();
    database::execute(&f.db,"INSERT INTO NativeWorkflow(id,projectId,kind,status,stepsJson,configJson,createdAt,updatedAt) VALUES(?,?,'continue','done','[]',?,1720000000000,1720000001000)",&[json!(workflow),json!(p),json!(json!({"planId":plan}).to_string())]).unwrap();
    (p, draft, workflow)
}

#[test]
fn completed_works_are_independent_snapshots_with_generation_time() {
    let mut f = Fixture::new();
    let (p, draft, workflow) = seed_finished_work(&mut f);
    changyi_desktop::works::backfill(&f.db).unwrap();
    let works = f.request("GET", "/api/works", Value::Null).unwrap();
    assert_eq!(works["works"].as_array().unwrap().len(), 1);
    let id = works["works"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(works["works"][0]["chapterCount"], 1);
    assert_eq!(works["works"][0]["generatedAt"], "2024-07-03T09:46:41.000Z");
    f.request(
        "PATCH",
        &format!("/api/projects/{p}/drafts/{draft}"),
        json!({"content":"后来修改的草稿"}),
    )
    .unwrap();
    let original = f
        .request("GET", &format!("/api/works/{id}"), Value::Null)
        .unwrap();
    assert_eq!(
        original["work"]["chapters"][0]["content"],
        "已完成作品的独立正文"
    );
    changyi_desktop::works::backfill(&f.db).unwrap();
    assert_eq!(
        database::query(
            &f.db,
            "SELECT id FROM NativeWork WHERE workflowId=?",
            &[json!(workflow)]
        )
        .unwrap()
        .len(),
        1
    );
    f.request("DELETE", &format!("/api/projects/{p}"), Value::Null)
        .unwrap();
    let kept = f
        .request("GET", &format!("/api/works/{id}"), Value::Null)
        .unwrap();
    assert!(kept["work"]["sourceProjectId"].is_null());
    assert_eq!(kept["work"]["sourceProjectName"], "测试小说");
    assert_eq!(
        kept["work"]["chapters"][0]["content"],
        original["work"]["chapters"][0]["content"]
    );
    let reopened = database::open(f.dir.path()).unwrap();
    assert_eq!(
        database::query(
            &reopened,
            "SELECT id FROM NativeWorkChapter WHERE workId=?",
            &[json!(id)]
        )
        .unwrap()
        .len(),
        1
    );
}

#[test]
fn deleted_work_does_not_reappear_during_migration_and_keeps_source_draft() {
    let mut f = Fixture::new();
    let (p, draft, _) = seed_finished_work(&mut f);
    changyi_desktop::works::backfill(&f.db).unwrap();
    let works = f.request("GET", "/api/works", Value::Null).unwrap();
    let id = works["works"][0]["id"].as_str().unwrap();
    f.request("DELETE", &format!("/api/works/{id}"), Value::Null)
        .unwrap();
    changyi_desktop::works::backfill(&f.db).unwrap();
    drop(database::open(f.dir.path()).unwrap());
    assert_eq!(
        f.request("GET", "/api/works", Value::Null).unwrap()["works"],
        json!([])
    );
    assert!(f
        .request("GET", &format!("/api/works/{id}"), Value::Null)
        .is_err());
    assert_eq!(
        f.request(
            "GET",
            &format!("/api/projects/{p}/drafts/{draft}"),
            Value::Null
        )
        .unwrap()["draft"]["content"],
        "已完成作品的独立正文"
    );
}

#[test]
fn automation_settings_are_global_and_migrate_existing_disabled_preferences() {
    let mut f = Fixture::new();
    let p = f.create();
    let q = f.create();
    f.request(
        "PATCH",
        "/api/settings/automation",
        json!({"autoAccept":false,"autoSynthesis":false}),
    )
    .unwrap();
    assert_eq!(
        changyi_desktop::automation::settings(&f.db, &p).unwrap(),
        changyi_desktop::automation::settings(&f.db, &q).unwrap()
    );
    assert_eq!(
        changyi_desktop::automation::settings(&f.db, &p).unwrap()["autoAccept"],
        false
    );
    assert!(f
        .request("PATCH", "/api/settings/automation", json!({"sound":false}))
        .is_err());
    f.db.execute("DROP TABLE NativeGlobalAutomation", [])
        .unwrap();
    database::execute(&f.db,"INSERT INTO NativeAutomationSettings(projectId,autoAccept,autoSynthesis,sound) VALUES(?,0,1,0)",&[json!(p)]).unwrap();
    let db = database::open(f.dir.path()).unwrap();
    assert_eq!(
        changyi_desktop::automation::global_settings(&db).unwrap(),
        json!({"autoAccept":false,"autoSynthesis":true})
    );
}

fn wait_run(f: &mut Fixture, run: &str, expected: &str) -> Value {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        let row = f
            .request("GET", &format!("/api/analysis/{run}"), Value::Null)
            .unwrap()["run"]
            .clone();
        if ["done", "failed", "canceled"].contains(&row["status"].as_str().unwrap_or("")) {
            assert_eq!(row["status"], expected, "{row}");
            return row;
        }
        assert!(std::time::Instant::now() < deadline, "{row}");
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

#[test]
fn draft_length_repairs_once_and_rejects_failed_repair_without_overwriting() {
    for repaired in [true, false] {
        let mut f = Fixture::new();
        let restored = f
            .request("POST", "/api/projects/restore", backup())
            .unwrap();
        let project = restored["project"]["id"].as_str().unwrap().to_string();
        let plan = f
            .request(
                "GET",
                &format!("/api/projects/{project}/plans"),
                Value::Null,
            )
            .unwrap()["plans"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let (address, server) = automation_mock(vec![
            json!({"title":"未完成","content":"字".repeat(1500)}),
            json!({"title":"修复","content":"字".repeat(if repaired {2000} else {1600})}),
        ]);
        let profile = automation_profile(&mut f, &address);
        let run = f.request("POST", &format!("/api/projects/{project}/analysis"), json!({"taskType":"draft","profileId":profile,"payload":{"planId":plan,"outlineIndex":1}})).unwrap()["runId"].as_str().unwrap().to_string();
        wait_run(&mut f, &run, if repaired { "done" } else { "failed" });
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].contains("1800–3500"));
        let drafts = f
            .request(
                "GET",
                &format!("/api/projects/{project}/plans/{plan}/drafts"),
                Value::Null,
            )
            .unwrap();
        assert_eq!(
            drafts["drafts"][0]["content"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            if repaired { 2000 } else { 4 }
        );
        if repaired {
            let draft = drafts["drafts"][0]["id"].as_str().unwrap();
            f.request(
                "PATCH",
                &format!("/api/projects/{project}/drafts/{draft}"),
                json!({"content":"作者短文"}),
            )
            .unwrap();
        }
    }
}

#[test]
fn cross_draft_checks_cite_real_evidence_and_invalidate_after_edit_or_delete() {
    let mut input = backup();
    input["continuityIssues"] = json!([]);
    input["memoryProposals"] = json!([]);
    input["continuationPlans"] = json!([{"id":"a","direction":"甲方向","outline":[{"index":1},{"index":2}]},{"id":"b","direction":"乙方向","outline":[{"index":1}]}]);
    input["draftChapters"] = json!([
        {"id":"a1","planId":"a","index":1,"title":"前章","content":"😀玄铁令只能由掌门开启。"},
        {"id":"a2","planId":"a","index":2,"title":"本章","content":"林舟直接打开玄铁令。"},
        {"id":"b1","planId":"b","index":1,"title":"另一方向","content":"其他方向秘密不能发送。"}]);
    let mut f = Fixture::new();
    let project = f.request("POST", "/api/projects/restore", input).unwrap()["project"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let rows = database::query(
        &f.db,
        "SELECT id,planId,\"index\" FROM DraftChapter WHERE projectId=? ORDER BY content",
        &[json!(project)],
    )
    .unwrap();
    let first = rows
        .iter()
        .find(|row| {
            row["index"] == 1
                && rows
                    .iter()
                    .any(|other| other["planId"] == row["planId"] && other["index"] == 2)
        })
        .unwrap();
    let plan = first["planId"].as_str().unwrap().to_string();
    let prior = first["id"].as_str().unwrap().to_string();
    let target = rows.iter().find(|row| row["index"] == 2).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let other = rows.iter().find(|row| row["planId"] != plan).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let issue = json!({"category":"设定","severity":"error","description":"开启条件不符","draftExcerpts":["直接打开玄铁令"],"memoryRefs":[],"draftRefs":[{"ref":"D1","excerpt":"玄铁令只能由掌门开启"},{"ref":"D99","excerpt":"其他方向秘密不能发送"}]});
    let mut invalid = issue.clone();
    invalid["draftExcerpts"] = json!(["虚构的本章证据"]);
    let (address, server) = automation_mock(vec![
        json!({"issues":[issue.clone(),invalid]}),
        json!({"issues":[issue]}),
    ]);
    let profile = automation_profile(&mut f, &address);
    for delete in [false, true] {
        let args = json!({"taskType":"continuity-check","profileId":profile,"payload":{"planId":plan,"draftId":target}});
        let preview = f
            .request(
                "POST",
                &format!("/api/projects/{project}/analysis/preview"),
                args.clone(),
            )
            .unwrap();
        assert!(preview["preview"]["note"]
            .as_str()
            .unwrap()
            .contains("其他续写章节"));
        let run = f
            .request("POST", &format!("/api/projects/{project}/analysis"), args)
            .unwrap()["runId"]
            .as_str()
            .unwrap()
            .to_string();
        wait_run(&mut f, &run, "done");
        let issues = f
            .request(
                "GET",
                &format!("/api/projects/{project}/issues"),
                Value::Null,
            )
            .unwrap();
        assert_eq!(
            issues["issues"].as_array().unwrap().len(),
            1,
            "无逐字证据的问题不应保存"
        );
        let evidence = &issues["issues"][0]["evidence"];
        assert_eq!(evidence.as_array().unwrap().len(), 2);
        assert_eq!(evidence[1]["draftId"], prior);
        assert_eq!(evidence[1]["startOffset"], 2, "emoji 定位须使用 UTF-16");
        assert!(evidence
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["draftId"] != other));
        if delete {
            f.request(
                "DELETE",
                &format!("/api/projects/{project}/drafts/{prior}"),
                Value::Null,
            )
            .unwrap();
        } else {
            f.request(
                "PATCH",
                &format!("/api/projects/{project}/drafts/{prior}"),
                json!({"content":"😀玄铁令只能由掌门开启。补充内容。"}),
            )
            .unwrap();
        }
        assert!(f
            .request(
                "GET",
                &format!("/api/projects/{project}/issues"),
                Value::Null
            )
            .unwrap()["issues"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(f
            .request(
                "GET",
                &format!("/api/projects/{project}/drafts/{target}"),
                Value::Null
            )
            .unwrap()["draft"]["continuityCheckedAt"]
            .is_null());
    }
    for request in server.join().unwrap() {
        assert!(request.contains("玄铁令只能由掌门开启"));
        assert!(!request.contains("其他方向秘密不能发送"));
    }
}

#[test]
fn editing_previous_draft_while_model_runs_rejects_stale_generation_and_checks() {
    for task in ["draft", "continuity-check"] {
        let mut f = Fixture::new();
        let mut input = backup();
        input["continuityIssues"] = json!([]);
        input["memoryProposals"] = json!([]);
        input["continuationPlans"] = json!([{"id":"p","direction":"玄铁令","outline":[{"index":1,"title":"前章","summary":"开启规则"},{"index":2,"title":"后章","summary":"继续调查"}]}]);
        input["draftChapters"] = json!([{"id":"d1","planId":"p","index":1,"content":"只有掌门能开启玄铁令。"},{"id":"d2","planId":"p","index":2,"content":"后章原有正文。"}]);
        let project = f.request("POST", "/api/projects/restore", input).unwrap()["project"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let rows = database::query(
            &f.db,
            "SELECT id,planId,\"index\" FROM DraftChapter WHERE projectId=? ORDER BY \"index\"",
            &[json!(project)],
        )
        .unwrap();
        let prior = rows[0]["id"].as_str().unwrap();
        let target = rows[1]["id"].as_str().unwrap();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let response = if task == "draft" {
            automation_draft("新正文")
        } else {
            json!({"issues":[]})
        };
        let (address, server) = automation_mock_with_hook(vec![response], move |_| {
            ready_tx.send(()).unwrap();
            release_rx
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap();
        });
        let profile = automation_profile(&mut f, &address);
        let run = f.request("POST", &format!("/api/projects/{project}/analysis"),json!({"taskType":task,"profileId":profile,"payload":{"planId":rows[0]["planId"],"outlineIndex":2,"draftId":target}})).unwrap()["runId"].as_str().unwrap().to_string();
        ready_rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .unwrap();
        f.request(
            "PATCH",
            &format!("/api/projects/{project}/drafts/{prior}"),
            json!({"content":"作者修改了玄铁令的开启规则。"}),
        )
        .unwrap();
        release_tx.send(()).unwrap();
        let failed = wait_run(&mut f, &run, "failed");
        assert!(failed["error"].as_str().unwrap().contains("修改"));
        let saved = f
            .request(
                "GET",
                &format!("/api/projects/{project}/drafts/{target}"),
                Value::Null,
            )
            .unwrap();
        assert_eq!(saved["draft"]["content"], "后章原有正文。");
        assert!(saved["draft"]["continuityCheckedAt"].is_null());
        assert!(server.join().unwrap()[0].contains("只有掌门能开启玄铁令"));
    }
}

#[test]
fn orphan_drafts_from_legacy_backups_remain_editable_and_deletable() {
    let mut input = backup();
    input["continuationPlans"] = json!([]);
    let mut f = Fixture::new();
    let project = f.request("POST", "/api/projects/restore", input).unwrap()["project"]["id"].as_str().unwrap().to_string();
    let draft = database::query(&f.db, "SELECT id FROM DraftChapter WHERE projectId=?", &[json!(project)]).unwrap()[0]["id"].as_str().unwrap().to_string();
    let result = f.request("PATCH", &format!("/api/projects/{project}/drafts/{draft}"), json!({"content":"旧草稿手工修改。"})).unwrap();
    assert!(result["draft"]["continuityCheckedAt"].is_null());
    assert!(f.request("GET", &format!("/api/projects/{project}/issues"), Value::Null).unwrap()["issues"].as_array().unwrap().is_empty());
    f.request("DELETE", &format!("/api/projects/{project}/drafts/{draft}"), Value::Null).unwrap();
    assert!(database::query(&f.db, "SELECT id FROM DraftChapter WHERE projectId=?", &[json!(project)]).unwrap().is_empty());
}
