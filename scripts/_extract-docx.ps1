Add-Type -AssemblyName 'System.IO.Compression.FileSystem'

function Get-DocxText($path) {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($path)
  $entry = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
  $stream = $entry.Open()
  $reader = [System.IO.StreamReader]::new($stream)
  $xml = $reader.ReadToEnd()
  $reader.Close()
  $zip.Dispose()
  $text = [regex]::Replace($xml, '<[^>]+>', ' ')
  $text = $text -replace '\s+', ' '
  return $text.Trim()
}

$t = Get-DocxText 'C:\Users\mattm\career-ops\output\Matt_Amundson_TOP_2026.docx'
Write-Output $t
