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
        include_str!("../../../web/prisma/migrations/20261014070954_init/migration.sql"),
        include_str!(
            "../../../web/prisma/migrations/20261015045343_analysis_pipeline/migration.sql"
        ),
        include_str!(
            "../../../web/prisma/migrations/20261015055759_continuity_issue_draft/migration.sql"
        ),
        include_str!(
            "../../../web/prisma/migrations/20261015060705_memory_proposal_draft/migration.sql"
        ),
    ] {
        db.execute_batch(migration).unwrap();
    }
    db.execute("INSERT INTO NovelProject(id,name,createdAt,updatedAt) VALUES('old','旧项目',1720000000000,1720000000000)",[]).unwrap();
    drop(db);
    let before = fs::read(dir.path().join("app.db")).unwrap();
    let db = database::open(dir.path()).unwrap();
    assert_eq!(
        database::one(&db, "SELECT * FROM NovelProject", &[]).unwrap()["createdAt"],
        "2024-07-03T09:46:40.000Z"
    );
    drop(db);
    assert_eq!(fs::read(dir.path().join("app.db")).unwrap(), before);
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
