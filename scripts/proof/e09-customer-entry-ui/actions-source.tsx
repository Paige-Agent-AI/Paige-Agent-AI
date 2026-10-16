import {createRoot} from "react-dom/client";
import {Link,MemoryRouter,Route,Routes} from "react-router-dom";
import ActionItems from "../../../src/pages/app/ActionItems";
import {Toaster} from "../../../src/components/ui/toaster";
// Existing page/hook/router/guard/toaster; destination and SDK are explicit doubles.
createRoot(document.getElementById("root")!).render(<MemoryRouter initialEntries={["/app/actions"]}>
 <Routes><Route path="/app/actions" element={<><Link to="/app">Back to portal</Link><ActionItems/></>}/>
 <Route path="/app" element={<p>Existing portal test destination</p>}/></Routes><Toaster/>
</MemoryRouter>);
