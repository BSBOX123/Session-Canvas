import XtermView from './terminal/XtermView'

/** 단계 1: 창 하나에 터미널 하나. 캔버스와 다중 노드는 단계 2. */
function App(): React.JSX.Element {
  return (
    <div className="app">
      <XtermView nodeId="main" cwd={null} command={null} />
    </div>
  )
}

export default App
