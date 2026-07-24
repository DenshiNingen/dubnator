use serde::Serialize;
use std::sync::Mutex;
use tauri::Emitter;

const LAUNCHPAD_LIVE_MODE: &[u8] = &[0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x0e, 0x00, 0xf7];

struct MidiOutputPort {
    id: String,
    connection: midir::MidiOutputConnection,
}

// Dropping a midir connection closes its port. Keep every generic input and
// the Launchpad output ports alive for the lifetime of the app.
struct MidiState {
    inputs: Mutex<Vec<midir::MidiInputConnection<()>>>,
    outputs: Mutex<Vec<MidiOutputPort>>,
}

impl Default for MidiState {
    fn default() -> Self {
        Self {
            inputs: Mutex::new(Vec::new()),
            outputs: Mutex::new(Vec::new()),
        }
    }
}

impl Drop for MidiState {
    fn drop(&mut self) {
        if let Ok(outputs) = self.outputs.get_mut() {
            for output in outputs {
                let _ = output.connection.send(LAUNCHPAD_LIVE_MODE);
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MidiPortInfo {
    id: String,
    name: String,
    manufacturer: String,
}

#[derive(Serialize)]
struct MidiPorts {
    inputs: Vec<MidiPortInfo>,
    outputs: Vec<MidiPortInfo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MidiMessage {
    device_id: String,
    name: String,
    data: Vec<u8>,
}

fn is_launchpad_midi_port(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    (name.contains("launchpad mini") || name.contains("lpminimk3")) && !name.contains("daw")
}

/// Rescan MIDI. All inputs remain available to generic MIDI learn; output
/// connections are opened only for Launchpad Mini MK3 MIDI (not DAW) ports so
/// Dubnator does not claim unrelated synth/controller outputs.
#[tauri::command]
fn connect_midi(
    app: tauri::AppHandle,
    state: tauri::State<'_, MidiState>,
) -> Result<MidiPorts, String> {
    let mut input_connections = state.inputs.lock().map_err(|e| e.to_string())?;
    let mut output_connections = state.outputs.lock().map_err(|e| e.to_string())?;
    input_connections.clear();
    output_connections.clear();

    let input_lister = midir::MidiInput::new("dubnator-scan-in").map_err(|e| e.to_string())?;
    let input_ports = input_lister.ports();
    let mut inputs = Vec::new();

    for (index, port) in input_ports.iter().enumerate() {
        let name = input_lister
            .port_name(port)
            .unwrap_or_else(|_| format!("MIDI {}", index + 1));
        let id = format!("input-{index}");
        let input = midir::MidiInput::new("dubnator-in").map_err(|e| e.to_string())?;
        let ports = input.ports();
        let current_port = match ports.get(index) {
            Some(port) => port,
            None => continue,
        };
        let app_handle = app.clone();
        let event_id = id.clone();
        let event_name = name.clone();
        let connection = input
            .connect(
                current_port,
                "dubnator-in",
                move |_timestamp, message, _| {
                    let _ = app_handle.emit(
                        "midi",
                        MidiMessage {
                            device_id: event_id.clone(),
                            name: event_name.clone(),
                            data: message.to_vec(),
                        },
                    );
                },
                (),
            )
            .map_err(|e| e.to_string())?;
        input_connections.push(connection);
        inputs.push(MidiPortInfo {
            id,
            name,
            manufacturer: String::new(),
        });
    }

    let output_lister = midir::MidiOutput::new("dubnator-scan-out").map_err(|e| e.to_string())?;
    let output_ports = output_lister.ports();
    let mut outputs = Vec::new();
    for (index, port) in output_ports.iter().enumerate() {
        let name = output_lister
            .port_name(port)
            .unwrap_or_else(|_| format!("MIDI Out {}", index + 1));
        if !is_launchpad_midi_port(&name) {
            continue;
        }
        let id = format!("output-{index}");
        let output = midir::MidiOutput::new("dubnator-out").map_err(|e| e.to_string())?;
        let ports = output.ports();
        let current_port = match ports.get(index) {
            Some(port) => port,
            None => continue,
        };
        let connection = output
            .connect(current_port, "dubnator-out")
            .map_err(|e| e.to_string())?;
        output_connections.push(MidiOutputPort {
            id: id.clone(),
            connection,
        });
        outputs.push(MidiPortInfo {
            id,
            name,
            manufacturer: String::new(),
        });
    }

    Ok(MidiPorts { inputs, outputs })
}

#[tauri::command]
fn send_midi(
    output_id: String,
    message: Vec<u8>,
    state: tauri::State<'_, MidiState>,
) -> Result<(), String> {
    let mut outputs = state.outputs.lock().map_err(|e| e.to_string())?;
    let output = outputs
        .iter_mut()
        .find(|output| output.id == output_id)
        .ok_or_else(|| format!("MIDI output not connected: {output_id}"))?;
    output.connection.send(&message).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(MidiState::default())
        .invoke_handler(tauri::generate_handler![connect_midi, send_midi])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running Dubnator");
}
