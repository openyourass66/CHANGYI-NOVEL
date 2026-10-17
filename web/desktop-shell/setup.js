const api = window.changyiDesktop;
const field = (id) => document.getElementById(id);
field("choose").onclick = async () => {
  field("error").textContent = "";
  field("choose").disabled = true;
  field("start").disabled = true;
  try {
    const result = await api.chooseDirectory();
    if (!result.ok) throw new Error(result.error);
    if (!result.value) return;
    field("directory").value = result.value;
  } catch (error) { field("error").textContent = error.message; }
  finally {
    field("choose").disabled = false;
    field("start").disabled = !field("directory").value;
  }
};
field("start").onclick = async () => {
  if (!field("directory").value) { field("error").textContent = "请先选择数据保存文件夹。"; return; }
  field("error").textContent = "";
  field("storage-form").setAttribute("aria-busy", "true");
  for (const control of document.querySelectorAll("button,input")) control.disabled = true;
  field("start").textContent = "正在打开…";
  field("status").textContent = "正在准备数据并打开工作区，请稍候…";
  try {
    const result = await api.applyStorage({ directory: field("directory").value });
    if (!result.ok) throw new Error(result.error);
  } catch (error) {
    field("error").textContent = error.message;
    field("status").textContent = "";
    field("storage-form").setAttribute("aria-busy", "false");
    field("start").textContent = "开始使用";
    for (const control of document.querySelectorAll("button,input")) control.disabled = false;
  }
};
