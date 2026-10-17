const api = window.changyiDesktop;
const field = (id) => document.getElementById(id);
const action = () => document.querySelector('input[name="action"]:checked').value;
function showSource() { field("source-fields").hidden = action() !== "import"; }
for (const radio of document.querySelectorAll('input[name="action"]')) radio.addEventListener("change", showSource);
async function choose(purpose) {
  field("error").textContent = "";
  try {
    const result = await api.chooseDirectory(purpose);
    if (!result.ok) throw new Error(result.error);
    if (!result.value) return;
    if (purpose === "destination") field("directory").value = result.value;
    else {
      field("source").add(new Option(result.value, result.value));
      field("source").value = result.value;
    }
  } catch (error) { field("error").textContent = error.message; }
}
field("choose").onclick = () => choose("destination");
field("browse").onclick = () => choose("source");
field("start").onclick = async () => {
  if (!field("directory").value) { field("error").textContent = "请先选择数据保存文件夹。"; return; }
  if (action() === "import" && !field("source").value) { field("error").textContent = "请选择原数据目录。"; return; }
  for (const control of document.querySelectorAll("button,input,select")) control.disabled = true;
  field("status").textContent = "正在准备数据并打开工作区，请稍候…";
  try {
    const result = await api.applyStorage({ directory: field("directory").value, action: action(), sourceDirectory: field("source").value });
    if (!result.ok) throw new Error(result.error);
  } catch (error) {
    field("error").textContent = error.message;
    field("status").textContent = "";
    for (const control of document.querySelectorAll("button,input,select")) control.disabled = false;
  }
};
api.getStorage().then((result) => {
  if (!result.ok) throw new Error(result.error);
  for (const item of result.value.sources) field("source").add(new Option(`${item.projectCount} 个项目 · ${item.directory}`, item.directory));
  if (result.value.sources.length) {
    field("source").value = result.value.sources[0].directory;
    document.querySelector('input[value="import"]').checked = true;
    showSource();
  }
}).catch((error) => { field("error").textContent = error.message; });
