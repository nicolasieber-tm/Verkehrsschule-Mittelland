(function() {
  var body = document.getElementById('sessions-body');
  var addBtn = document.getElementById('add-session');
  if (!body || !addBtn) return;
  addBtn.addEventListener('click', function() {
    var i = body.children.length;
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input name="sessions[' + i + '][day]" type="text" required placeholder="Freitag"></td>' +
      '<td><input name="sessions[' + i + '][date]" type="date" required></td>' +
      '<td><input name="sessions[' + i + '][from]" type="time" required></td>' +
      '<td><input name="sessions[' + i + '][to]" type="time" required></td>' +
      '<td><button type="button" class="btn btn-ghost remove-session">×</button></td>';
    body.appendChild(tr);
  });
  body.addEventListener('click', function(e) {
    if (e.target.classList.contains('remove-session')) {
      if (body.children.length > 1) e.target.closest('tr').remove();
    }
  });
})();
