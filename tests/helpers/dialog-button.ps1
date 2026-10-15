# Clicks a button in a native dialog owned by the given browser process, without taking keyboard focus:
# Windows will not let a background process bring the dialog forward, so the button gets BM_CLICK directly.
# Used only by tests/update-e2e.mjs for Chrome's "select folder" dialog. Prints CLICKED or NOTFOUND.
param([int]$procId,[string]$name)
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -Namespace YzTest -Name User32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h,uint m,System.IntPtr w,System.IntPtr l);'
$A=[System.Windows.Automation.AutomationElement]
$byPid=New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty,$procId)
foreach($w in $A::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$byPid)){
  $byName=New-Object System.Windows.Automation.PropertyCondition($A::NameProperty,$name)
  foreach($e in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,$byName)){
    if($e.Current.NativeWindowHandle -ne 0 -and $e.Current.ClassName -eq 'Button'){
      [YzTest.User32]::PostMessage([System.IntPtr]$e.Current.NativeWindowHandle,0x00F5,[System.IntPtr]::Zero,[System.IntPtr]::Zero)|Out-Null
      'CLICKED'; exit 0
    }
  }
}
'NOTFOUND'; exit 1
