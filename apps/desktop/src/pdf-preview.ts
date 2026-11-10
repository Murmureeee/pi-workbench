import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { previewRasterResultSchema } from '@pi-workbench/shared'

// Windows PowerShell 5.1 provides the OS WinRT projection; pwsh 7 does not. All input
// is JSON on stdin, never code/path interpolation. No original or temp PDF is written.
const script = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$reason = 'decode'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.DataWriter,Windows.Storage.Streams,ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]
  $null = [Windows.Data.Pdf.PdfPageRenderOptions,Windows.Data.Pdf,ContentType=WindowsRuntime]
  $null = [Windows.Foundation.IAsyncAction,Windows.Foundation,ContentType=WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation'+[char]96+'1' } | Select-Object -First 1
  $asAction = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
  function Result($operation, $type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
    return $task.GetAwaiter().GetResult()
  }
  $q = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $raw = [Convert]::FromBase64String([string]$q.bytes)
  if ($raw.Length -gt 8388608) { throw 'limit' }
  $inputStream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $writer = New-Object Windows.Storage.Streams.DataWriter($inputStream)
  $writer.WriteBytes($raw)
  $null = Result ($writer.StoreAsync()) ([uint32])
  $null = $writer.DetachStream()
  $writer.Dispose()
  $inputStream.Seek(0)
  $pdf = Result ([Windows.Data.Pdf.PdfDocument]::LoadFromStreamAsync($inputStream)) ([Windows.Data.Pdf.PdfDocument])
  if ($pdf.PageCount -lt 1 -or $pdf.PageCount -gt 12) { $reason = 'pages'; throw 'pages' }
  $pages = New-Object 'System.Collections.Generic.List[string]'
  $total = 0
  for ($i=0; $i -lt $pdf.PageCount; $i++) {
    $page = $pdf.GetPage([uint32]$i)
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    try {
      $w = [double]$page.Size.Width
      $h = [double]$page.Size.Height
      if ($w -le 0 -or $h -le 0 -or $w -gt 20000 -or $h -gt 20000) { $reason = 'render_limit'; throw 'geometry' }
      $scale = [Math]::Min(1200 / $w, 1800 / $h)
      $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
      $options.DestinationWidth = [uint32][Math]::Max(1, [Math]::Floor($w * $scale))
      $options.DestinationHeight = [uint32][Math]::Max(1, [Math]::Floor($h * $scale))
      $options.IsIgnoringHighContrast = $true
      $renderTask = $asAction.Invoke($null, @($page.RenderToStreamAsync($stream, $options)))
      $null = $renderTask.GetAwaiter().GetResult()
      $total += $stream.Size
      if ($stream.Size -eq 0 -or $total -gt 16777216) { $reason = 'render_limit'; throw 'render limit' }
      $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
      try {
        $loaded = Result ($reader.LoadAsync([uint32]$stream.Size)) ([uint32])
        if ($loaded -ne $stream.Size) { throw 'partial raster' }
        $buffer = New-Object byte[] ([int]$stream.Size)
        $reader.ReadBytes($buffer)
        $pages.Add([Convert]::ToBase64String($buffer))
      } finally { $reader.Dispose() }
    } finally { $page.Dispose(); $stream.Dispose() }
  }
  $inputStream.Dispose()
  @{ok=$true;pages=@($pages.ToArray())} | ConvertTo-Json -Compress
} catch { @{ok=$false;reason=$reason} | ConvertTo-Json -Compress }
`

/** Bounded OS PDF-to-pixels conversion, with no viewer scripts, network or file URL.
 * Cancellation/timeout kills only this owned read-only helper and waits for exit. Never
 * returns a partially rendered document; malformed output and unsupported hosts fail. */
export function renderPdf(bytes: Buffer, active: () => boolean): Promise<Buffer[]> {
  if (process.platform !== 'win32' || !process.env.SystemRoot) {
    return Promise.reject(Error('此宿主未提供已验证的 Windows PDF 渲染；请使用原件入口。'))
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const output: Buffer[] = []
    let length = 0,
      failure = ''
    const stop = (message: string) => {
      failure ||= message
      child.kill()
    }
    const timeout = setTimeout(
      () => stop('PDF 渲染超过 30 秒；未加载部分文档，请使用原件入口。'),
      30000,
    )
    const cancel = setInterval(() => {
      if (!active()) {
        stop('预览已取消，未加载 PDF。')
      }
    }, 100)
    child.stdout.on('data', (part: Buffer) => {
      length += part.length
      if (length > 24 * 1024 * 1024) {
        stop('PDF 渲染结果超过限额；未加载部分文档。')
      } else {
        output.push(part)
      }
    })
    child.stderr.resume()
    child.stdin.on('error', () => undefined)
    child.once('error', () => {
      failure ||= 'Windows PDF 辅助进程无法启动；请使用原件入口。'
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      clearInterval(cancel)
      try {
        if (failure || code !== 0 || !active()) {
          throw Error(failure || 'PDF 渲染失败或已取消；请使用原件入口。')
        }
        const result = previewRasterResultSchema.parse(
          JSON.parse(
            Buffer.concat(output)
              .toString('utf8')
              .replace(/^\ufeff/, ''),
          ),
        )
        if (!result.ok) {
          throw Error(
            result.reason === 'pages'
              ? 'PDF 超过 12 页或没有可显示页面；未加载部分文档，请使用原件入口。'
              : result.reason === 'render_limit'
                ? 'PDF 页面或渲染结果超过限额；未加载部分文档。'
                : 'PDF 损坏、加密或当前 Windows 渲染不可用；请使用原件入口。',
          )
        }
        const pages = result.pages.map((page) => Buffer.from(page, 'base64'))
        if (pages.reduce((sum, page) => sum + page.length, 0) > 16 * 1024 * 1024) {
          throw Error('PDF 渲染结果超过 16 MiB。')
        }
        resolve(pages)
      } catch (error) {
        reject(error instanceof Error ? error : Error('PDF 渲染结果无法核验；请使用原件入口。'))
      }
    })
    child.stdin.end(JSON.stringify({ bytes: bytes.toString('base64') }))
  })
}
