// Loading skeleton for the move details page
export default function MovieLoading() {
  return (
    <div className="container mx-auto py-6 px-4">
      <div className="animate-pulse">
        {/* Movie hero section skeleton */}
        <div className="h-[40vh] w-full bg-gray-800 rounded-xl mb-6"></div>
        
        {/* Tabs nav skeleton */}
        <div className="h-12 border-b border-gray-800 mb-6">
          <div className="flex gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-8 w-24 bg-gray-800 rounded"></div>
            ))}
          </div>
        </div>
        
        {/* Content skeleton */}
        <div className="flex flex-col md:flex-row gap-8">
          {/* Sidebar */}
          <div className="w-full md:w-1/3 lg:w-1/4 space-y-6">
            <div className="h-64 bg-gray-800 rounded-lg"></div>
            <div className="h-80 bg-gray-800 rounded-lg"></div>
          </div>
          
          {/* Main content */}
          <div className="w-full md:w-2/3 lg:w-3/4">
            <div className="h-8 w-48 bg-gray-800 rounded mb-4"></div>
            <div className="h-4 w-full bg-gray-800 rounded mb-2"></div>
            <div className="h-4 w-full bg-gray-800 rounded mb-2"></div>
            <div className="h-4 w-3/4 bg-gray-800 rounded mb-6"></div>
            
            <div className="h-8 w-32 bg-gray-800 rounded mb-4"></div>
            <div className="h-32 bg-gray-800 rounded mb-6"></div>
            
            <div className="h-8 w-40 bg-gray-800 rounded mb-4"></div>
            <div className="h-64 bg-gray-800 rounded"></div>
          </div>
        </div>
      </div>
    </div>
  );
}