// 根布局：全局 Provider 与 Toast；页面路由在 src/routes/ 下单独建文件
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Navigate, createRootRouteWithContext, useRouterState } from "@tanstack/react-router";
import { Toaster } from "sonner";

function NotFoundComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/") return null;
  return <Navigate to="/" replace />;
}

function ErrorComponent({ error }: { error: unknown; reset: () => void }) {
  console.error(error);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/") return null;
  return <Navigate to="/" replace />;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster
        position="top-center"
        toastOptions={{
          className: "!rounded-2xl !border !border-white/70 !bg-white/90 !text-ink !shadow-xl !shadow-lilac/15 !backdrop-blur",
          duration: 2600,
        }}
      />
    </QueryClientProvider>
  );
}
