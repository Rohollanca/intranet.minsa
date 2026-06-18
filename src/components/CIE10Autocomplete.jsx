import { useState, useEffect, useRef, useMemo } from 'react';
// Importamos la data. Si hay muchos registros, es buena idea usar useMemo o cargarlos dinámicamente,
// pero al ser un archivo local JSON, vite lo compila eficientemente.
import cie10Data from '../data/cie10-peru.json';

const CIE10Autocomplete = ({ value, onChange, placeholder = "Buscar diagnóstico o código CIE-10 (ej: J12 o Neumonía)..." }) => {
  const [query, setQuery] = useState(value ? `${value.codigoCIE} - ${value.descripcionCIE}` : '');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  
  const wrapperRef = useRef(null);
  const listRef = useRef(null);

  // Optimización: Filtrar máximo 10 resultados
  const filteredOptions = useMemo(() => {
    if (!query) return [];
    
    // Si el usuario ya seleccionó y el input es igual a la selección, no mostrar la lista o mostrarla vacía
    if (value && query === `${value.codigoCIE} - ${value.descripcionCIE}`) return [];

    const lowerQuery = query.toLowerCase();
    const results = [];
    
    for (let i = 0; i < cie10Data.length; i++) {
      const item = cie10Data[i];
      if (item.codigo.toLowerCase().includes(lowerQuery) || item.descripcion.toLowerCase().includes(lowerQuery)) {
        results.push(item);
        if (results.length >= 10) break; // Máximo 10 resultados por rendimiento
      }
    }
    return results;
  }, [query, value]);

  // Manejo de clics fuera del componente para cerrar el dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
        // Si no se seleccionó nada válido y se sale, limpiar o revertir
        if (!value) {
          setQuery('');
        } else {
          setQuery(`${value.codigoCIE} - ${value.descripcionCIE}`);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value]);

  // Manejo del scroll del teclado
  useEffect(() => {
    if (isOpen && listRef.current && listRef.current.children[activeIndex]) {
      listRef.current.children[activeIndex].scrollIntoView({
        block: 'nearest',
      });
    }
  }, [activeIndex, isOpen]);

  const handleSelect = (item) => {
    onChange({ codigoCIE: item.codigo, descripcionCIE: item.descripcion });
    setQuery(`${item.codigo} - ${item.descripcion}`);
    setIsOpen(false);
    setActiveIndex(0);
  };

  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown') setIsOpen(true);
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredOptions[activeIndex]) {
          handleSelect(filteredOptions[activeIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
      default:
        break;
    }
  };

  const highlightMatch = (text, highlight) => {
    if (!highlight.trim()) return text;
    const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === highlight.toLowerCase() ? (
            <span key={i} className="bg-yellow-200 text-slate-900 font-bold">{part}</span>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="relative">
        <input
          type="text"
          className="w-full bg-slate-50 border-2 border-transparent rounded-2xl p-5 text-sm focus:bg-white focus:border-minsa-red/20 outline-none transition-all shadow-inner font-medium text-slate-800"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setActiveIndex(0);
            if (value) onChange(null); // Limpiar selección si edita el texto
          }}
          onKeyDown={handleKeyDown}
          onClick={() => setIsOpen(true)}
        />
        {value && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 bg-green-100 text-green-800 text-[10px] font-black px-3 py-1.5 rounded-lg flex items-center border border-green-200">
            CIE-10: {value.codigoCIE}
          </div>
        )}
      </div>

      {isOpen && filteredOptions.length > 0 && (
        <ul 
          ref={listRef}
          className="absolute z-50 left-0 right-0 top-[calc(100%+8px)] bg-white border border-slate-200 rounded-2xl shadow-2xl max-h-64 overflow-y-auto overflow-x-hidden"
        >
          {filteredOptions.map((item, index) => (
            <li
              key={item.codigo}
              onClick={() => handleSelect(item)}
              onMouseEnter={() => setActiveIndex(index)}
              className={`px-6 py-4 cursor-pointer flex items-center border-b border-slate-50 last:border-0 transition-colors ${
                index === activeIndex ? 'bg-slate-50' : 'bg-white'
              }`}
            >
              <div className="flex-shrink-0 w-20">
                <span className="font-black text-minsa-red text-xs bg-red-50 px-2 py-1 rounded">
                  {highlightMatch(item.codigo, query)}
                </span>
              </div>
              <div className="flex-1 text-sm text-slate-700 font-medium truncate ml-2">
                {highlightMatch(item.descripcion, query)}
              </div>
            </li>
          ))}
        </ul>
      )}
      
      {isOpen && query.length >= 2 && filteredOptions.length === 0 && !value && (
        <div className="absolute z-50 left-0 right-0 top-[calc(100%+8px)] bg-white border border-slate-200 rounded-2xl shadow-2xl p-6 text-center text-slate-500 text-sm font-medium">
          No se encontraron diagnósticos para "{query}"
        </div>
      )}
    </div>
  );
};

export default CIE10Autocomplete;
