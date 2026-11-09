document.addEventListener("DOMContentLoaded", function () {
	var clip = !!(navigator.clipboard && navigator.clipboard.writeText);
	var live = document.querySelector("p[aria-live]");
	var tabs = document.querySelector(".tabs");
	var copyBtn = tabs && tabs.querySelector(".tabbar button.copy");
	if (clip) document.querySelectorAll("button.copy").forEach(function (b) {
		if (b !== copyBtn) b.hidden = false;
		var label = b.textContent;
		b.addEventListener("click", function () {
			navigator.clipboard.writeText(b.dataset.copy).then(function () {
				b.textContent = b.dataset.done;
				live.textContent = b.dataset.done;
				setTimeout(function () { b.textContent = label; }, 1500);
			}, function () {});
		});
	});
	if (!tabs) return;
	tabs.classList.add("js");
	tabs.querySelector('[role="tablist"]').hidden = false;
	var tabEls = Array.prototype.slice.call(tabs.querySelectorAll('[role="tab"]'));
	var panelOf = function (t) { return document.getElementById(t.getAttribute("aria-controls")); };
	function select(i) {
		tabEls.forEach(function (t, j) {
			t.setAttribute("aria-selected", j === i ? "true" : "false");
			t.setAttribute("tabindex", j === i ? "0" : "-1");
			panelOf(t).hidden = j !== i;
		});
		var panel = panelOf(tabEls[i]);
		var pre = panel.querySelector("pre");
		copyBtn.hidden = !(clip && pre);
		if (pre) {
			copyBtn.dataset.copy = pre.textContent;
			copyBtn.setAttribute("aria-label", panel.dataset.label);
		}
	}
	tabEls.forEach(function (t, i) {
		t.addEventListener("click", function () { select(i); });
		t.addEventListener("keydown", function (e) {
			var n = tabEls.length;
			var j = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "Enter" ? i : -1;
			if (j < 0) return;
			e.preventDefault();
			tabEls[j].focus();
			if (e.key === "Enter") select(i);
		});
	});
	select(0);
});