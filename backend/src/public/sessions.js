(function() {
  var body = document.getElementById('sessions-body');
  var addBtn = document.getElementById('add-session');
  if (!body || !addBtn) return;

  var startDate = document.querySelector('input[name="starts_at_date"]');
  var startTime = document.querySelector('input[name="starts_at_time"]');

  var WEEKDAYS = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
  function weekdayFromDate(dStr) {
    if (!dStr) return '';
    var parts = dStr.split('-');
    if (parts.length !== 3) return '';
    var d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    if (isNaN(d.getTime())) return '';
    return WEEKDAYS[d.getUTCDay()];
  }

  function firstRow() {
    return body.children[0] || null;
  }

  function applyStartToFirstRow() {
    var row = firstRow();
    if (!row) return;
    var dayInput = row.querySelector('input[name$="[day]"]');
    var dateInput = row.querySelector('input[name$="[date]"]');
    var fromInput = row.querySelector('input[name$="[from]"]');
    if (dateInput && startDate) dateInput.value = startDate.value || '';
    if (fromInput && startTime && !fromInput.value) fromInput.value = startTime.value || '';
    if (fromInput && startTime && startTime.value) fromInput.value = startTime.value;
    if (dayInput && startDate) {
      var wd = weekdayFromDate(startDate.value);
      if (wd) dayInput.value = wd;
    }
  }

  function lockFirstRow() {
    var row = firstRow();
    if (!row) return;
    var dayInput = row.querySelector('input[name$="[day]"]');
    var dateInput = row.querySelector('input[name$="[date]"]');
    if (dateInput) {
      dateInput.readOnly = true;
      dateInput.style.background = '#f5f5f5';
      dateInput.title = 'Wird automatisch vom Kursbeginn übernommen';
    }
    if (dayInput) {
      dayInput.readOnly = true;
      dayInput.style.background = '#f5f5f5';
      dayInput.title = 'Wird automatisch vom Kursbeginn übernommen';
    }
    var removeBtn = row.querySelector('.remove-session');
    if (removeBtn) removeBtn.style.visibility = 'hidden';
  }

  function refresh() {
    lockFirstRow();
    applyStartToFirstRow();
  }

  if (startDate) startDate.addEventListener('change', refresh);
  if (startDate) startDate.addEventListener('input', refresh);
  if (startTime) startTime.addEventListener('change', refresh);
  if (startTime) startTime.addEventListener('input', refresh);

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
    var dateInput = tr.querySelector('input[name$="[date]"]');
    var dayInput = tr.querySelector('input[name$="[day]"]');
    if (dateInput && dayInput) {
      dateInput.addEventListener('change', function() {
        var wd = weekdayFromDate(dateInput.value);
        if (wd) dayInput.value = wd;
      });
    }
  });

  body.addEventListener('click', function(e) {
    if (e.target.classList.contains('remove-session')) {
      var row = e.target.closest('tr');
      if (row === firstRow()) return;
      if (body.children.length > 1) row.remove();
    }
  });

  refresh();
})();
