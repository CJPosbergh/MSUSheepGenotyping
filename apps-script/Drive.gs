/**
 * Drive layout (created by Genotyping > Set up):
 *   MSU Sheep Genotyping/
 *     Forms/  Templates/  Submissions/<ID Flock>/ (form, Photos/, invoices, Results/)  Batches/  Partner bills/
 */

function folderIdFromUrl_(url) {
  var m = String(url || '').match(/[-\w]{20,}/);
  return m ? m[0] : '';
}

function folderUrl_(folder) {
  return 'https://drive.google.com/drive/folders/' + folder.getId();
}

function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function settingFolder_(key) {
  var id = settings_()[key];
  if (!id) throw new Error('Drive folders are not set up yet. In the tracker, choose Genotyping > Set up.');
  return DriveApp.getFolderById(String(id));
}

/** The submission's own folder, created on first use and remembered in Submissions.Drive_Folder. */
function submissionFolder_(subsT, sub) {
  var id = folderIdFromUrl_(sub.Drive_Folder);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ }
  }
  var parent = settingFolder_('Submissions_Folder_ID');
  var name = sub.Submission_ID + ' ' + (clean_(producerOf_(sub).Flock_Name) || '');
  var f = childFolder_(parent, name.trim());
  update_(subsT, sub, { Drive_Folder: folderUrl_(f) });
  return f;
}

function saveBase64_(folder, name, base64, mime) {
  var bytes = Utilities.base64Decode(String(base64).replace(/^data:[^,]+,/, ''));
  var blob = Utilities.newBlob(bytes, mime || 'application/octet-stream', name);
  var it = folder.getFilesByName(name);
  while (it.hasNext()) it.next().setTrashed(true);   // replace an earlier copy with the same name
  return folder.createFile(blob);
}

function fileUrl_(file) {
  return 'https://drive.google.com/file/d/' + file.getId() + '/view';
}
