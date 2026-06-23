use std::sync::Mutex;
use tauri::Emitter;

// Keep MIDI input connections alive for the app's lifetime — dropping a
// MidiInputConnection closes its port, so we stash them in managed state.
struct MidiState(Mutex<Vec<midir::MidiInputConnection<()>>>);

/// (Re)scan and connect to every MIDI input port. Each incoming message is
/// emitted to the webview as a "midi" event carrying the raw [status, d1, d2]
/// bytes, which the JS MidiMapper.handleMessage consumes unchanged. Returns the
/// connected port names so the UI can list them. Call again to rescan (hot-plug).
#[tauri::command]
fn connect_midi(
    app: tauri::AppHandle,
    state: tauri::State<'_, MidiState>,
) -> Result<Vec<String>, String> {
    let mut conns = state.0.lock().map_err(|e| e.to_string())?;
    conns.clear(); // close previous connections before rescanning

    let lister = midir::MidiInput::new("dubnator-scan").map_err(|e| e.to_string())?;
    let ports = lister.ports();
    let mut names = Vec::new();

    for (i, port) in ports.iter().enumerate() {
        let name = lister
            .port_name(port)
            .unwrap_or_else(|_| format!("MIDI {}", i + 1));
        // connect() consumes the MidiInput, so use a fresh one per port and
        // re-fetch the port from it by index (port order is stable per scan).
        let input = midir::MidiInput::new("dubnator-in").map_err(|e| e.to_string())?;
        let input_ports = input.ports();
        let p = match input_ports.get(i) {
            Some(p) => p,
            None => continue,
        };
        let app_handle = app.clone();
        let conn = input
            .connect(
                p,
                "dubnator-in",
                move |_timestamp, message, _| {
                    let _ = app_handle.emit("midi", message.to_vec());
                },
                (),
            )
            .map_err(|e| e.to_string())?;
        conns.push(conn);
        names.push(name);
    }
    Ok(names)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(MidiState(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![connect_midi])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running Dubnator");
}
