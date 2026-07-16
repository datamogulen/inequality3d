<?php
// Kort QR-vänlig adress: https://hedin.it/i3d/?c=SE&m=co2
// → infosidan för modellen. Hör till github.com/datamogulen/inequality3d.
$q = $_SERVER['QUERY_STRING'] ?? '';
header('Location: https://hedin.it/inequality3d/m.html' . ($q ? ('?' . $q) : ''), true, 302);
exit;
