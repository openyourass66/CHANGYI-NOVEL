//! Browser integration tests communicate with the real native API over stdin.
use changyi_desktop::{
    api::{self, ApiRequest},
    database,
};
use serde_json::json;
use std::{
    io::{self, BufRead, Write},
    path::PathBuf,
};

fn main() {
    let root = PathBuf::from(std::env::args().nth(1).expect("temporary workspace path"));
    let mut db = database::open(&root).unwrap();
    for line in io::stdin().lock().lines() {
        let response = match line {
            Ok(line) => match serde_json::from_str::<ApiRequest>(&line) {
                Ok(request) => serde_json::to_value(api::request(&mut db, &root, request)).unwrap(),
                Err(e) => json!({"status":400,"body":{"error":e.to_string()}}),
            },
            Err(_) => break,
        };
        println!("{}", response);
        io::stdout().flush().unwrap();
    }
}
