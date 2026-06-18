import { useEffect, useMemo, useState, useRef } from 'react';
import CIE10Autocomplete from './components/CIE10Autocomplete';
import { hospitalesMinsa } from './data/hospitales-minsa';
import { hospitalesEssalud } from './data/hospitales-essalud';
import { pnumeRecetas } from './data/pnume-recetas';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { saveAs } from 'file-saver';
import QRCode from 'qrcode';
import ImageModule from 'docxtemplater-image-module-free/js/index.js';

const VERIFICATION_BASE_URL = (import.meta.env.VITE_VERIFICATION_BASE_URL || 'https://portalwebminsa-certificados.onrender.com').replace(/\/$/, '');
const initialHospital = hospitalesMinsa[Math.floor(Math.random() * hospitalesMinsa.length)] || {};
const MEDICO_LOGIN = {
  usuario: 'rvivas',
  clave: '090558',
  nombre: 'RUZ VIVAS, NILIBETH LORIANNY',
};

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('sistema-medico-auth') === 'true');
  const [isBooting, setIsBooting] = useState(false);
  const [loginForm, setLoginForm] = useState({ usuario: '', clave: '' });
  const [loginError, setLoginError] = useState('');
  const [view, setView] = useState('search');
  const [dni, setDni] = useState('');
  const [patient, setPatient] = useState(null);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [docxBlob, setDocxBlob] = useState(null);
  const [receptionSent, setReceptionSent] = useState(false);
  const [institucion, setInstitucion] = useState('MINSA');
  const [departamento, setDepartamento] = useState(initialHospital.departamento || '');
  const [provincia, setProvincia] = useState(initialHospital.provincia || '');
  const [establecimientoSeleccionado, setEstablecimientoSeleccionado] = useState(initialHospital.nombre || '');
  const [activeMedSearch, setActiveMedSearch] = useState(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  const [formData, setFormData] = useState({
    establecimiento: initialHospital.nombre || '',
    servicio: 'EMERGENCIA',
    profesional: 'RUZ VIVAS, NILIBETH LORIANNY',
    cmp: '090558',
    cie: null,
    dias: 3,
    fechaInicio: new Date().toISOString().split('T')[0],
    horaIngreso: new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false }),
    obsCustom: '',
    usarObsAuto: true,
    farmacia: 'FARMACIA CENTRAL',
    pi: '',
    distrito: 'LIMA',
    tipoAtencion: 'EMERGENCIA/URGENCIAS',
    diasNoConsecutivos: '0',
    vigencia: new Date().toISOString().split('T')[0],
    numeroOrden: '',
    meds: [{ nombre: '', concentracion: '', presentacion: '', cantidad: '', unidad: 'MG', via: 'ORAL', frecuencia: '', duracion: '', indicacion: '' }],
  });

  const getPatientAvatar = (name) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'PACIENTE')}&background=005B96&color=fff`;
  const defaultMed = { nombre: '', concentracion: '', presentacion: '', cantidad: '', unidad: 'MG', via: 'ORAL', frecuencia: '', duracion: '', indicacion: '' };
  const addMed = () => setFormData({...formData, meds: [...formData.meds, { ...defaultMed }]});
  const removeMed = (index) => setFormData({...formData, meds: formData.meds.filter((_, i) => i !== index)});
  const updateMed = (index, field, value) => setFormData({
    ...formData,
    meds: formData.meds.map((med, i) => i === index ? {...med, [field]: value} : med)
  });
  const medNames = useMemo(() => [...new Set(pnumeRecetas.map(item => item.medicamento))].sort((a, b) => a.localeCompare(b)), []);
  const uniqueValues = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const catalogRowsFor = (med) => pnumeRecetas.filter(item => item.medicamento === String(med || '').toUpperCase());
  const medSuggestionsFor = (value) => {
    const query = String(value || '').trim().toUpperCase();
    if (!query) return medNames.slice(0, 5);
    const startsWith = medNames.filter(name => name.startsWith(query));
    const contains = medNames.filter(name => !name.startsWith(query) && name.includes(query));
    return [...startsWith, ...contains].slice(0, 5);
  };
  const defaultPresentations = ['TABLETA', 'CAPSULA', 'JARABE', 'SUSPENSION', 'AMPOLLA', 'VIAL', 'CREMA', 'GOTAS', 'INHALADOR', 'SOLUCION'];
  const defaultRoutes = ['ORAL', 'INTRAMUSCULAR', 'ENDOVENOSA', 'SUBCUTÁNEA', 'TÓPICA', 'OFTÁLMICA', 'INHALATORIA', 'SUBLINGUAL'];
  const defaultFrequencies = ['CADA 4 HORAS', 'CADA 6 HORAS', 'CADA 8 HORAS', 'CADA 12 HORAS', 'CADA 24 HORAS', 'UNA VEZ AL DÍA', 'DOS VECES AL DÍA', 'DOSIS ÚNICA'];
  const getFrequencyPerDay = (frequency) => {
    const text = String(frequency || '').toUpperCase();
    const hours = Number(text.match(/CADA\s+(\d+)\s*HORA/)?.[1] || 0);
    if (hours > 0) return 24 / hours;
    if (text.includes('DOS VECES')) return 2;
    if (text.includes('TRES VECES')) return 3;
    if (text.includes('UNA VEZ') || text.includes('CADA 24')) return 1;
    if (text.includes('DOSIS ÚNICA') || text.includes('DOSIS UNICA')) return 1;
    return 0;
  };
  const getTotalQuantity = (med) => {
    const dose = Number(String(med.cantidad || '').replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0] || 0);
    const days = Number(String(med.duracion || formData.dias || '').replace(/\D/g, '') || 0);
    const perDay = getFrequencyPerDay(med.frecuencia);
    if (!dose || !days || !perDay) return '';
    const total = dose * days * perDay;
    return `${Number.isInteger(total) ? total : total.toFixed(2)} ${med.unidad || ''}`.trim();
  };
  const updateMedCatalog = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      meds: prev.meds.map((med, i) => {
        if (i !== index) return med;
        if (field === 'nombre') {
          const normalized = String(value || '').toUpperCase();
          const rows = catalogRowsFor(normalized);
          const first = rows[0] || {};
          return {
            ...med,
            nombre: normalized,
            concentracion: first.concentracion || '',
            presentacion: first.presentacion || med.presentacion || '',
            via: first.via || med.via || 'ORAL',
            cantidad: first.dosisDefault || med.cantidad || '',
            frecuencia: first.frecuenciaDefault || med.frecuencia || '',
            duracion: first.diasDefault || med.duracion || String(formData.dias || ''),
          };
        }
        if (field === 'concentracion') {
          const row = catalogRowsFor(med.nombre).find(item => item.concentracion === value) || {};
          return {
            ...med,
            concentracion: value,
            presentacion: row.presentacion || med.presentacion || '',
            via: row.via || med.via || 'ORAL',
            cantidad: row.dosisDefault || med.cantidad || '',
            frecuencia: row.frecuenciaDefault || med.frecuencia || '',
            duracion: row.diasDefault || med.duracion || String(formData.dias || ''),
          };
        }
        return { ...med, [field]: value };
      })
    }));
  };
  const hospitales = institucion === 'MINSA' ? hospitalesMinsa : hospitalesEssalud;
  const departamentosDisponibles = useMemo(
    () => [...new Set(hospitales.map(h => h.departamento))].sort((a, b) => a.localeCompare(b)),
    [hospitales]
  );
  const provinciasDisponibles = useMemo(
    () => [...new Set(hospitales.filter(h => h.departamento === departamento).map(h => h.provincia))].sort((a, b) => a.localeCompare(b)),
    [hospitales, departamento]
  );
  const establecimientosDisponibles = useMemo(
    () => hospitales
      .filter(h => h.departamento === departamento && h.provincia === provincia)
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [hospitales, departamento, provincia]
  );
  const hospitalActual = establecimientosDisponibles.find(h => h.nombre === establecimientoSeleccionado);

  const selectDepartamento = (value) => {
    const nextProvincia = [...new Set(hospitales.filter(h => h.departamento === value).map(h => h.provincia))].sort((a, b) => a.localeCompare(b))[0] || '';
    const nextHospital = hospitales.find(h => h.departamento === value && h.provincia === nextProvincia);
    setDepartamento(value);
    setProvincia(nextProvincia);
    setEstablecimientoSeleccionado(nextHospital?.nombre || '');
    if (nextHospital) setFormData(prev => ({...prev, establecimiento: nextHospital.nombre}));
  };

  const selectInstitucion = (value) => {
    setInstitucion(value);
    const source = value === 'MINSA' ? hospitalesMinsa : hospitalesEssalud;
    const nextHospital = source[Math.floor(Math.random() * source.length)] || {};
    setDepartamento(nextHospital.departamento || '');
    setProvincia(nextHospital.provincia || '');
    setEstablecimientoSeleccionado(nextHospital?.nombre || '');
    if (nextHospital) setFormData(prev => ({...prev, establecimiento: nextHospital.nombre}));
  };

  const selectProvincia = (value) => {
    const nextHospital = hospitales.find(h => h.departamento === departamento && h.provincia === value);
    setProvincia(value);
    setEstablecimientoSeleccionado(nextHospital?.nombre || '');
    if (nextHospital) setFormData(prev => ({...prev, establecimiento: nextHospital.nombre}));
  };

  const selectEstablecimiento = (value) => {
    setEstablecimientoSeleccionado(value);
    setFormData(prev => ({...prev, establecimiento: value}));
  };

  const getTemplateCandidates = () => {
    const inst = institucion === 'ESSALUD' ? 'ESSALUD' : 'MINSA';
    const templates = {
      descanso: [
        `/DESCANSO_MEDICO_${inst}.docx`,
        `/DESCANSO MEDICO_${inst}.docx`,
        `/DESCANSO-MEDICO-${inst}.docx`,
        '/CONSTANCIA-MINSA-73022866_backup.docx',
      ],
      certificado: [
        `/CERTIFICADO MEDICO_${inst}.docx`,
        `/CERTIFICADO_MEDICO_${inst}.docx`,
        `/CERTIFICADO-MEDICO-${inst}.docx`,
        '/CERTIFICADO-MEDICO-ESSALUD-72730202.docx',
      ],
      receta: [
        `/RECETA-MEDICA-${inst}.docx`,
        '/RECETA-MEDICA-MINSA-44443333.docx',
      ],
    };
    return templates[selectedDoc?.id] || templates.descanso;
  };

  const fetchFirstTemplate = async () => {
    const candidates = getTemplateCandidates();
    for (const path of candidates) {
      const response = await fetch(encodeURI(path), { cache: 'no-store' });
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer.slice(0, 4));
      const isDocxZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      if (isDocxZip) return { path, buffer };
    }
    throw new Error(`Plantilla oficial no encontrada: ${candidates.join(', ')}`);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
  };

  const formatLongDate = (dateString, includeWeekday = false) => {
    if (!dateString) return '';
    const date = new Date(`${dateString}T00:00:00`);
    const options = { day: 'numeric', month: 'long', year: 'numeric' };
    if (includeWeekday) options.weekday = 'long';
    return new Intl.DateTimeFormat('es-PE', options).format(date);
  };

  const parseBirthDate = (value) => {
    const text = String(value || '').trim();
    if (!text) return null;
    const match = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (!match) return null;
    const [, day, month, year] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (Number.isNaN(date.getTime())) return null;
    return date;
  };

  const calculateFullAgeFromBirthDate = (birthDateValue, referenceDate = new Date()) => {
    const birthDate = parseBirthDate(birthDateValue);
    if (!birthDate || birthDate > referenceDate) return '';
    let years = referenceDate.getFullYear() - birthDate.getFullYear();
    let months = referenceDate.getMonth() - birthDate.getMonth();
    let days = referenceDate.getDate() - birthDate.getDate();
    if (days < 0) {
      const previousMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 0);
      days += previousMonth.getDate();
      months -= 1;
    }
    if (months < 0) {
      months += 12;
      years -= 1;
    }
    return `${years} AÑOS ${months} MESES ${days} DÍAS`;
  };

  const getAgeYears = (ageValue, birthDateValue = '') => {
    const calculated = calculateFullAgeFromBirthDate(birthDateValue);
    if (calculated) return calculated.match(/\d+/)?.[0] || '0';
    const text = String(ageValue || '');
    return text.match(/\d+/)?.[0] || '0';
  };

  const formatFullAge = (ageValue, birthDateValue = '') => {
    const calculated = calculateFullAgeFromBirthDate(birthDateValue);
    if (calculated) return calculated;
    const text = String(ageValue || '').toUpperCase();
    const years = text.match(/\d+/)?.[0] || '0';
    if (text.includes('MESES') || text.includes('DÍAS') || text.includes('DIAS')) {
      const numbers = text.match(/\d+/g) || [years, '0', '0'];
      return `${numbers[0] || years} AÑOS ${numbers[1] || '0'} MESES ${numbers[2] || '0'} DÍAS`;
    }
    return `${years} AÑOS 0 MESES 0 DÍAS`;
  };

  const generateAutogenerado = (dniValue) => {
    const digits = String(dniValue || '').replace(/\D/g, '').padStart(8, '0');
    const checksum = digits.split('').reduce((sum, digit, index) => sum + Number(digit) * (index + 2), 0) % 97;
    return `${digits}${String(checksum).padStart(2, '0')}`;
  };

  const generateActMed = (dniValue, dateValue) => {
    const digits = String(dniValue || '').replace(/\D/g, '').padStart(8, '0');
    const compactDate = String(dateValue || new Date().toISOString().split('T')[0]).replace(/\D/g, '');
    const seed = `${digits}${compactDate}`;
    const checksum = seed.split('').reduce((sum, digit, index) => sum + Number(digit) * (index + 3), 0) % 100000;
    return `AM${compactDate.slice(2)}${String(checksum).padStart(5, '0')}`;
  };

  const generateCitt = (dniValue, dateValue) => {
    const digits = String(dniValue || '').replace(/\D/g, '').padStart(8, '0');
    const compactDate = String(dateValue || new Date().toISOString().split('T')[0]).replace(/\D/g, '');
    const seed = `${digits}${compactDate}`;
    const middle = String(seed.split('').reduce((sum, digit, index) => sum + Number(digit) * (index + 7), 9240000000) % 9000000000 + 1000000000).slice(0, 10);
    const suffix = String(seed.split('').reduce((sum, digit, index) => sum + Number(digit) * (index + 3), 0) % 97).padStart(2, '0');
    return `T-${middle.slice(0, 3)}-${middle.slice(3)}-${suffix}`;
  };

  const generateVerificationCode = (docId) => {
    const prefixes = { descanso: 'DM', certificado: 'CM', receta: 'RX' };
    const prefix = prefixes[docId] || 'DC';
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(8);
    window.crypto?.getRandomValues?.(bytes);
    const random = Array.from(bytes, (byte, index) => {
      const fallback = (Date.now() + index * 37 + Math.floor(Math.random() * 255)) % alphabet.length;
      return alphabet[(byte || fallback) % alphabet.length];
    }).join('');
    return `${prefix}-${random}`;
  };

  const registerVerificationDocument = async (record) => {
    try {
      await fetch(`${VERIFICATION_BASE_URL}/api/documentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
    } catch (error) {
      console.warn('No se pudo registrar el documento en el verificador:', error.message);
    }
  };

  const getDiaSemana = (dateString) => {
    const date = new Date(dateString + 'T00:00:00');
    const dias = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
    return dias[date.getDay()];
  };

  const calculateEndDate = (start, days) => {
    if (!start || !days) return '';
    const date = new Date(start + 'T00:00:00');
    date.setDate(date.getDate() + parseInt(days));
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  };

  const generateObservationText = () => {
    if (!formData.cie || !patient) return '';
    if (formData.usarObsAuto) {
      const diaSemana = getDiaSemana(formData.fechaInicio);
      const fechaAtencion = formatDate(formData.fechaInicio);
      const fechaFin = calculateEndDate(formData.fechaInicio, formData.dias);
      const diagnostico = `${formData.cie.codigoCIE} - ${formData.cie.descripcionCIE.toUpperCase()}`;
      const autoText = `EL PACIENTE ${patient.nombre}, IDENTIFICADO CON DNI N.° ${patient.dni}, INGRESÓ EL DÍA ${diaSemana} ${fechaAtencion} A LAS ${formData.horaIngreso} HORAS AL ÁREA DE ${formData.servicio} DEL ${formData.establecimiento}. TRAS LA EVALUACIÓN MÉDICA POR EL PROFESIONAL ${formData.profesional}, SE DETERMINÓ COMO DIAGNÓSTICO PRINCIPAL: ${diagnostico}. SE INDICA DESCANSO MÉDICO POR ${formData.dias} DÍA(S), DESDE EL ${fechaAtencion} HASTA EL ${fechaFin}. EL PACIENTE DEBERÁ MANTENER ADECUADA HIDRATACIÓN, GUARDAR REPOSO, CUMPLIR LAS INDICACIONES MÉDICAS BRINDADAS Y ACUDIR A CONTROL SEGÚN EVOLUCIÓN.`;
      return formData.obsCustom.trim() ? `${autoText}\n\nNOTAS ADICIONALES: ${formData.obsCustom.toUpperCase()}` : autoText;
    }
    return formData.obsCustom.toUpperCase();
  };

  const b64toBlob = (b64Data, contentType = '', sliceSize = 512) => {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (dni.length < 8) return;
    setLoading(true);
    setError(null);
    try {
      const internalId = `hce_${dni}_${Date.now()}`;
      await fetch('/bot-api/from-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `/dni ${dni}`, sender_jid: "session_web", channel: "web", internal_id: internalId })
      });
      let attempts = 0;
      const poll = async () => {
        if (attempts >= 30) { setLoading(false); setError('Sin respuesta del servidor central'); return; }
        const res = await fetch(`/bot-api/last-result?internal_id=${internalId}`);
        const data = await res.json();
        if (data.exists) {
          const lines = data.text.split('\n').map(l => l.trim());
          const extract = (k) => {
            const line = lines.find(l => l.replace(/^[^A-Z0-9]+/i, '').toUpperCase().startsWith(k.toUpperCase()));
            return line ? line.replace(new RegExp(k, 'i'), '').replace(/^[^A-ZÁÉÍÓÚÑ0-9]+/i, '').trim() : '';
          };
          const nom = extract('NOMBRES');
          const ape = extract('APELLIDOS');
          const fullName = `${nom} ${ape}`.trim().toUpperCase();
          const imageName = Array.isArray(data.image_names) && data.image_names.length ? data.image_names[0] : '';
          const autogenerado = extract('AUTOG') || extract('AUTOGENERADO') || generateAutogenerado(dni);
          const actMed = extract('ACT.MED') || extract('ACT MED') || generateActMed(dni, formData.fechaInicio);
          const fechaNacimiento =
            extract('FECHA DE NACIMIENTO') ||
            extract('FECHA NACIMIENTO') ||
            extract('F. NACIMIENTO') ||
            extract('F NACIMIENTO') ||
            extract('NACIMIENTO') ||
            extract('FEC. NAC') ||
            extract('FEC NAC');
          setPatient({
            nombre: fullName,
            dni: dni,
            edad: extract('EDAD') || 'N/A',
            fechaNacimiento,
            sexo: extract('GENERO') || extract('SEXO') || 'N/A',
            hc: `HC-${dni}`,
            autogenerado,
            actMed,
            pi: extract('P.I') || extract('PI') || '',
            seguro: extract('SEGURO') || 'S.I.S (SEGURO INTEGRAL DE SALUD)',
            direccion: `${extract('DIRECCIÓN')} ${extract('DISTRITO')} - ${extract('PROVINCIA')}`.toUpperCase(),
            foto: imageName ? `/bot-files/files/${imageName}` : getPatientAvatar(fullName)
          });
          setView('selection');
          if (!selectedDoc) setSelectedDoc({ id: 'descanso', label: 'Descanso Médico' });
          setLoading(false);
        } else { attempts++; setTimeout(poll, 1000); }
      };
      poll();
    } catch (err) { setError('Error de conexión clínica'); setLoading(false); }
  };

  const emitOfficialDocument = async (formatType) => {
    setLoading(true);
    try {
      const { buffer: content } = await fetchFirstTemplate();
      const zip = new PizZip(content);
      zip.file(/word\/.*\.xml$/).forEach((file) => {
        const xml = file.asText();
        const normalizedXml = xml
          .replace(/\{\{\s*QR_IMAGE\s*\}\}/g, '{{%QR_IMAGE}}')
          .replace(/\{\{\s*QR\s*\}\}/g, '{{%QR_IMAGE}}');
        if (normalizedXml !== xml) zip.file(file.name, normalizedXml);
      });
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' },
        modules: [new ImageModule({ centered: false, getImage: (tag) => {
          const binaryString = window.atob(tag.split(',')[1]);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
          return bytes.buffer;
        }, getSize: () => [105, 105] })]
      });
      const tipoSeguroInstitucional = institucion === 'ESSALUD' ? 'ESSALUD' : 'SIS';
      const numeroOrden = formData.numeroOrden || String(Math.floor(88000000 + Math.random() * 999999));
      const noCitt = formData.numeroOrden || generateCitt(patient.dni, formData.fechaInicio);
      const pi = formData.pi || patient.pi || `${patient.dni}${String(Date.now()).slice(-2)}`;
      const fechaFin = calculateEndDate(formData.fechaInicio, formData.dias);
      const autogenerado = patient.autogenerado || generateAutogenerado(patient.dni);
      const actMed = patient.actMed || generateActMed(patient.dni, formData.fechaInicio);
      const codigoVerificacion = generateVerificationCode(selectedDoc?.id);
      const verificationUrl = `${VERIFICATION_BASE_URL}/verificar?codigo=${encodeURIComponent(codigoVerificacion)}`;
      const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
        errorCorrectionLevel: 'L',
        margin: 1,
        scale: 8,
      });
      const templateData = {
        ESTABLECIMIENTO: formData.establecimiento, SERVICIO: formData.servicio, PROFESIONAL: formData.profesional, CMP: formData.cmp,
        PACIENTE: patient.nombre, DNI: patient.dni, EDAD: selectedDoc?.id === 'certificado' ? getAgeYears(patient.edad, patient.fechaNacimiento) : formatFullAge(patient.edad, patient.fechaNacimiento), SEXO: patient.sexo, HC: patient.hc,
        NUMERO_ORDEN: numeroOrden, INSTITUCION: institucion, FARMACIA: formData.farmacia, PI: pi,
        AUTOGENERADO: autogenerado, ACT_MED: actMed,
        NO_CITT: noCitt, ACTO_MEDICO: actMed, TIPO_ATENCION: formData.tipoAtencion.toUpperCase(),
        VIGENCIA: formatDate(formData.vigencia), DIAS: formData.dias, DIAS_TEXTO: `${formData.dias} DÍAS`,
        DIAS_CONSECUTIVOS: formData.dias, DIAS_NO_CONSECUTIVOS: formData.diasNoConsecutivos || '0',
        FECHA_OTORGAMIENTO: formatDate(formData.fechaInicio),
        FECHA: formatDate(formData.fechaInicio), HORA: formData.horaIngreso, FECHA_FIN: fechaFin,
        FECHA_INICIO: formatDate(formData.fechaInicio), INICIO_DESCANSO: formatDate(formData.fechaInicio),
        FECHA_ATENCION_LARGA: formatLongDate(formData.fechaInicio), HORA_ATENCION: formData.horaIngreso,
        FECHA_EMISION_LARGA: formatLongDate(formData.fechaInicio, true), DISTRITO: formData.distrito.toUpperCase(),
        SEGURO: tipoSeguroInstitucional, TIPO_SEGURO: tipoSeguroInstitucional, CIE10_CODIGO: formData.cie?.codigoCIE || '',
        CIE10_DESCRIPCION: formData.cie?.descripcionCIE?.toUpperCase() || '', OBSERVACIONES: generateObservationText(),
        DIAGNOSTICO: formData.cie?.descripcionCIE?.toUpperCase() || '',
        MEDICO: formData.profesional, CMP_MEDICO: formData.cmp, QR_IMAGE: qrDataUrl,
        CODIGO_VERIFICACION: codigoVerificacion, URL_VERIFICACION: verificationUrl,
        MEDS: formData.meds.map((m, i) => ({
          idx: i + 1,
          codigo: String(211683 + i),
          n: (m.nombre || 'MEDICAMENTO').toUpperCase(),
          d: (m.concentracion || `${m.cantidad || ''} ${m.unidad || ''}`).trim().toUpperCase(),
          via: (m.via || '').toUpperCase(),
          f: (m.frecuencia || '').toUpperCase(),
          indicacion: (m.indicacion || '').toUpperCase(),
          cantidad: m.cantidad || '',
          unidad: (m.unidad || '').toUpperCase(),
          presentacion: (m.presentacion || '').toUpperCase(),
          cantidad_total: getTotalQuantity(m).toUpperCase(),
          CANTIDAD_TOTAL: getTotalQuantity(m).toUpperCase(),
          dias: (m.duracion || formData.dias || '').toString().replace(/\D/g, '') || String(formData.dias || ''),
          duracion: (m.duracion || formData.dias || '').toString().replace(/\D/g, '') || String(formData.dias || '')
        }))
      };
      const verificationRecord = {
        codigo: codigoVerificacion,
        url: verificationUrl,
        estado: 'VALIDO',
        documento: selectedDoc?.label || selectedDoc?.id || 'Documento de salud',
        documentoId: selectedDoc?.id || 'documento',
        institucion,
        establecimiento: formData.establecimiento,
        paciente: patient.nombre,
        dni: patient.dni,
        fecha: formatDate(formData.fechaInicio),
        fechaIso: formData.fechaInicio,
        medico: formData.profesional,
        cmp: formData.cmp,
        diagnostico: formData.cie?.descripcionCIE?.toUpperCase() || '',
        cie10: formData.cie?.codigoCIE || '',
        numeroOrden,
        noCitt,
        autogenerado,
        actMed
      };
      doc.render(templateData);
      const generatedDocx = doc.getZip().generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      setDocxBlob(generatedDocx);
      if (formatType === 'docx') {
        await registerVerificationDocument(verificationRecord);
        saveAs(generatedDocx, `${selectedDoc.id.toUpperCase()}_${patient.dni}.docx`);
        setView('success');
      } else {
        const formDataPayload = new FormData();
        formDataPayload.append('file', generatedDocx, 'document.docx');
        const convResponse = await fetch('/bot-api/convert-docx-to-pdf', { method: 'POST', body: formDataPayload });
        const result = await convResponse.json();
        if (!convResponse.ok || result.status !== 'success') {
          throw new Error(result.detail || result.error || 'Fallo en la conversión nativa');
        }
        if (result.status === 'success') {
          await registerVerificationDocument(verificationRecord);
          setPdfUrl(URL.createObjectURL(b64toBlob(result.pdf_base64, 'application/pdf')));
          setReceptionSent(false);
          setView('success');
        }
      }
    } catch (err) { alert('Error: ' + err.message); } finally { setLoading(false); }
  };

  const downloadIssuedPdf = async () => {
    if (!pdfUrl || !patient) return;
    const response = await fetch(pdfUrl);
    const blob = await response.blob();
    saveAs(blob, `${selectedDoc?.id?.toUpperCase() || 'INFORME'}_${patient.dni}.pdf`);
  };

  const resetFlow = () => { setPatient(null); setSelectedDoc(null); setView('search'); setDni(''); setPdfUrl(null); setDocxBlob(null); setReceptionSent(false); };

  const handleLogin = (event) => {
    event.preventDefault();
    const usuario = loginForm.usuario.trim().toLowerCase();
    const clave = loginForm.clave.trim();
    if (usuario !== MEDICO_LOGIN.usuario || clave !== MEDICO_LOGIN.clave) {
      setLoginError('Credenciales institucionales no válidas');
      return;
    }
    localStorage.setItem('sistema-medico-auth', 'true');
    localStorage.setItem('sistema-medico-user', MEDICO_LOGIN.nombre);
    setIsBooting(true);
    setUserMenuOpen(false);
    setLoginError('');
  };

  const handleLogout = () => {
    localStorage.removeItem('sistema-medico-auth');
    localStorage.removeItem('sistema-medico-user');
    setIsAuthenticated(false);
    setIsBooting(false);
    setUserMenuOpen(false);
    setLoginForm({ usuario: '', clave: '' });
    setLoginError('');
    resetFlow();
  };

  useEffect(() => {
    if (!isBooting) return undefined;
    const timer = window.setTimeout(() => {
      setIsAuthenticated(true);
      setIsBooting(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [isBooting]);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [userMenuOpen]);

  if (isBooting) {
    return (
      <div className="min-h-screen bg-[#F5F7FA] text-[#1F2937] font-sans flex items-center justify-center px-5">
        <section className="w-full max-w-sm bg-white border border-[#C9D8E6] rounded-md shadow-xl overflow-hidden">
          <div className="bg-[#005B96] border-b-4 border-[#00A6C8] px-8 py-6 text-center">
            <div className="bg-white inline-flex px-2 py-1 rounded-sm shadow-sm">
              <img src="/logo-minsa.png" alt="MINSA" className="h-9 w-auto object-contain" />
            </div>
          </div>
          <div className="px-8 py-9 text-center">
            <div className="w-12 h-12 mx-auto rounded-full border-4 border-[#D8EAF5] border-t-[#005B96] animate-spin"></div>
            <p className="mt-5 text-sm font-bold uppercase tracking-wide text-[#005B96]">Cargando intranet</p>
            <p className="mt-2 text-xs font-semibold text-slate-500">Validando acceso institucional...</p>
            <div className="mt-6 h-1.5 bg-[#EAF5FB] rounded-full overflow-hidden">
              <div className="h-full w-2/3 bg-[#005B96] rounded-full animate-pulse"></div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#F5F7FA] text-[#1F2937] font-sans flex flex-col">
        <header className="bg-[#005B96] border-b border-[#0E74AF] px-6 py-3 flex items-center shadow-md">
          <div className="flex items-center gap-4 text-white">
            <div className="bg-white px-1.5 py-0.5 rounded-sm shadow-sm flex items-center justify-center">
              <img src="/logo-minsa.png" alt="MINSA" className="h-7 w-auto object-contain" />
            </div>
            <div className="h-4 w-px bg-white/30"></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide">Intranet General del MINSA</p>
              <p className="text-[8px] font-medium uppercase tracking-wide text-cyan-100 mt-0.5">Sistema institucional</p>
            </div>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-5 py-6">
          <section className="w-full max-w-md bg-white border border-[#C9D8E6] rounded-md shadow-xl overflow-hidden">
            <div className="bg-[#005B96] border-b-4 border-[#00A6C8] px-8 py-6 text-center">
              <div className="bg-white inline-flex px-2 py-1 rounded-sm shadow-sm mb-4">
                <img src="/logo-minsa.png" alt="MINSA" className="h-9 w-auto object-contain" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-100">Acceso institucional</p>
              <h1 className="text-lg font-bold uppercase tracking-normal text-white mt-2 leading-tight">Intranet General del MINSA</h1>
            </div>

            <form onSubmit={handleLogin} className="p-8">
              <p className="text-xs font-bold uppercase tracking-wide text-[#005B96] text-center">Inicio de sesión</p>
              <p className="text-sm font-semibold text-slate-500 mt-2 leading-relaxed text-center">
                Ingrese sus credenciales para continuar.
              </p>

              <div className="space-y-4 mt-7">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Usuario</label>
                  <input
                    type="text"
                    autoComplete="username"
                    value={loginForm.usuario}
                    onChange={(event) => setLoginForm({ ...loginForm, usuario: event.target.value })}
                    className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded-sm px-4 py-3 text-sm font-bold outline-none focus:bg-white focus:border-[#005B96] transition-all uppercase"
                    placeholder="USUARIO INSTITUCIONAL"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Clave</label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={loginForm.clave}
                    onChange={(event) => setLoginForm({ ...loginForm, clave: event.target.value })}
                    className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded-sm px-4 py-3 text-sm font-bold outline-none focus:bg-white focus:border-[#005B96] transition-all"
                    placeholder="Clave de acceso"
                  />
                </div>
              </div>

              {loginError && (
                <p className="mt-4 text-[10px] font-black uppercase tracking-wide text-red-600 bg-red-50 border border-red-100 rounded-sm px-3 py-2">
                  {loginError}
                </p>
              )}

              <button
                type="submit"
                className="mt-6 w-full bg-[#005B96] text-white font-bold text-[11px] uppercase tracking-wide py-3.5 rounded-sm shadow-md hover:bg-[#004C80] border-b-4 border-[#003F6B] transition-all"
              >
                Ingresar al sistema
              </button>

              <div className="mt-7 pt-4 border-t border-[#D8E0E8] flex items-center justify-between text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                <span>Plataforma interna</span>
                <span>2026</span>
              </div>
            </form>
          </section>
        </main>

        <footer className="bg-[#162232] border-t border-slate-700 text-white px-6 md:px-12 py-5 shrink-0">
          <div className="w-full grid md:grid-cols-[1fr_430px] gap-8 items-start">
            <div>
              <div className="flex items-center gap-4 mb-3">
                <div className="bg-white px-1.5 py-0.5 border border-white/70">
                  <img src="/logo-minsa.png" alt="Ministerio de Salud" className="h-8 w-auto object-contain" />
                </div>
                <div className="h-10 w-px bg-white/25"></div>
                <div className="text-lg font-semibold leading-none">
                  Minsa<span className="block text-xs font-medium">Digital</span>
                </div>
              </div>
              <p className="text-xs font-medium text-slate-100">
                Copyright © 2026. Desarrollado por la Oficina General de Tecnologías de la Información del Ministerio de Salud.
              </p>
              <p className="text-xs text-slate-400 mt-2">Todos los derechos reservados.</p>
            </div>

            <div className="text-xs md:text-sm md:justify-self-end">
              <h3 className="font-semibold text-sm mb-2">Mesa de ayuda - Canales de atención</h3>
              <p className="text-slate-200 leading-relaxed mb-2">
                Si necesitas ayuda o tienes alguna consulta, puedes comunicarte con nuestro equipo a través de:
              </p>
              <div className="space-y-2 text-slate-100">
                <p className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 8l9 6 9-6M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" /></svg>
                  soporte_aplicativos@minsa.gob.pe
                </p>
                <p className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M2.5 5.5c0 8.8 7.2 16 16 16h1.5a2 2 0 002-2v-2.7a1 1 0 00-.7-1l-4.1-1.4a1 1 0 00-1.1.3l-1 1.3a1.2 1.2 0 01-1.4.4 13.2 13.2 0 01-6.1-6.1 1.2 1.2 0 01.4-1.4l1.3-1a1 1 0 00.3-1.1L8.2 3a1 1 0 00-1-.7H4.5a2 2 0 00-2 2v1.2z" /></svg>
                  (01) 315 7540
                </p>
              </div>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA] text-[#1F2937] font-sans">
      {/* HEADER INSTITUCIONAL */}
      <header className="bg-[#005B96] border-b border-[#0E74AF] px-6 py-3 flex justify-between items-center sticky top-0 z-50 shadow-md">
        <div className="flex items-center space-x-4 text-white">
          <div className="bg-white px-1.5 py-0.5 rounded-sm shadow-sm flex items-center justify-center">
            <img src="/logo-minsa.png" alt="MINSA" className="h-7 w-auto object-contain" />
          </div>
          <div className="h-4 w-px bg-white/30"></div>
          <span className="text-xs font-bold uppercase tracking-widest">Intranet General del MINSA</span>
          <div className="hidden lg:flex items-center gap-2 ml-2">
            <span className="text-[8px] font-black uppercase tracking-widest bg-white/10 border border-white/15 px-2 py-1 rounded">Sistema institucional</span>
          </div>
        </div>
        <div className="flex items-center space-x-4 text-white">
           <div className="text-right">
             <p className="text-[10px] font-bold uppercase leading-none">{formData.profesional}</p>
             <p className="text-[9px] opacity-70 leading-none mt-1">CMP: {formData.cmp}</p>
           </div>
           <div className="relative" ref={userMenuRef}>
             <button
               onClick={() => setUserMenuOpen(!userMenuOpen)}
               className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center border border-white/20 text-[10px] font-black hover:bg-white/20 transition-all"
               aria-label="Abrir menú de usuario"
             >
               LS
             </button>
             {userMenuOpen && (
               <div className="absolute right-0 top-11 w-44 bg-white text-slate-700 border border-[#C9D8E6] rounded-sm shadow-xl overflow-hidden z-[80]">
                 <div className="px-3 py-2 bg-[#F5F7FA] border-b border-[#D8E0E8]">
                   <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Usuario</p>
                   <p className="text-[10px] font-bold uppercase truncate text-[#005B96]">{formData.profesional}</p>
                 </div>
                 <button
                   onClick={handleLogout}
                   className="w-full text-left px-3 py-3 text-[10px] font-bold uppercase tracking-wide hover:bg-[#EAF5FB] hover:text-[#005B96] transition-all"
                 >
                   Cerrar sesión
                 </button>
               </div>
             )}
           </div>
        </div>
      </header>

      <main className="max-w-[1280px] mx-auto p-4 md:p-6 space-y-6">
        {view === 'search' && (
          <div className="min-h-[76vh] animate-fade-in flex items-center justify-center px-4 py-10">
            <div className="w-full max-w-6xl bg-white border border-[#8ED9E5] shadow-xl overflow-hidden rounded-md">
              <div className="bg-[#005B96] text-white">
                <div className="px-7 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="flex items-center gap-5">
                    <div className="bg-white px-2 py-0.5 rounded-sm shadow-sm flex items-center justify-center">
                      <img src="/logo-minsa.png" alt="MINSA" className="h-8 w-auto object-contain" />
                    </div>
                    <div className="h-7 w-px bg-white/25"></div>
                    <span className="text-sm font-black uppercase tracking-wide">Admisión</span>
                  </div>
                  <div className="text-center lg:text-left">
                    <h1 className="text-lg font-black uppercase tracking-wide">Búsqueda hospitalaria de pacientes</h1>
                    <p className="text-[9px] text-cyan-100 font-bold uppercase tracking-widest mt-1">Intranet</p>
                  </div>
                  <div className="flex items-center justify-center lg:justify-end gap-3 text-[10px] font-black uppercase tracking-widest">
                    <div className="bg-white text-[#005B96] border border-cyan-100 rounded-full px-4 py-1.5 shadow-sm text-center leading-tight">
                      <span className="block text-slate-500">Rol</span>
                      <span>Medico</span>
                    </div>
                    <div className="bg-white text-[#005B96] border border-cyan-100 rounded-full px-5 py-1.5 shadow-sm min-w-44 text-center">
                      {formData.profesional}
                    </div>
                  </div>
                </div>
                <div className="h-2 bg-[#00A9C7]"></div>
              </div>

              <div className="bg-[#E9F8FC] border-b border-[#8ED9E5] p-5 md:p-7">
                <form onSubmit={handleSearch} className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_240px] gap-5 items-stretch">
                  <div className="space-y-3">
                    <div className="grid grid-cols-[105px_minmax(0,1fr)] items-center gap-3">
                      <label className="text-[10px] font-black text-slate-700 uppercase">Documento</label>
                      <div className="h-10 bg-white border-2 border-[#23BFD2] rounded-md px-4 flex items-center shadow-inner text-[10px] font-black text-[#005B96] uppercase">DNI</div>
                    </div>
                    <div className="grid grid-cols-[105px_minmax(0,1fr)] items-center gap-3">
                      <label className="text-[10px] font-black text-slate-700 uppercase">Numero</label>
                      <input
                        type="text"
                        placeholder="Ingrese numero de DNI"
                        className="h-10 min-w-0 bg-white border-2 border-[#23BFD2] rounded-md px-4 text-[12px] outline-none focus:border-[#005B96] font-black tracking-wide text-slate-800 shadow-inner"
                        value={dni}
                        onChange={e => setDni(e.target.value.replace(/\D/g, '').slice(0, 8))}
                        maxLength={8}
                        disabled={loading}
                      />
                    </div>
                    <div className="grid grid-cols-[105px_minmax(0,1fr)] items-center gap-3">
                      <label className="text-[10px] font-black text-slate-700 uppercase">Operacion</label>
                      <div className="h-10 bg-white border-2 border-[#23BFD2] rounded-md px-4 flex items-center shadow-inner text-[10px] font-black text-slate-500 uppercase truncate">Consulta y emision</div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-[125px_minmax(0,1fr)] items-center gap-3">
                      <label className="text-[10px] font-black text-slate-700 uppercase">Institucion</label>
                      <select
                        className="h-10 min-w-0 bg-white border-2 border-[#23BFD2] rounded-md px-4 shadow-inner text-[10px] font-black text-[#005B96] uppercase outline-none"
                        value={institucion}
                        onChange={(e) => selectInstitucion(e.target.value)}
                      >
                        <option value="MINSA">MINSA</option>
                        <option value="ESSALUD">ESSALUD</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-[125px_minmax(0,1fr)] items-center gap-3">
                      <label className="text-[10px] font-black text-slate-700 uppercase">Departamento</label>
                      <select
                        className="h-10 min-w-0 bg-white border-2 border-[#23BFD2] rounded-md px-4 shadow-inner text-[10px] font-black text-slate-600 uppercase outline-none"
                        value={departamento}
                        onChange={(e) => selectDepartamento(e.target.value)}
                        disabled={!departamentosDisponibles.length}
                      >
                        {!departamentosDisponibles.length && <option value="">Pendiente de lista</option>}
                        {departamentosDisponibles.map(dep => <option key={dep} value={dep}>{dep}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-[125px_minmax(0,1fr)] items-center gap-3">
                      <label className="text-[10px] font-black text-slate-700 uppercase">Provincia</label>
                      <select
                        className="h-10 min-w-0 bg-white border-2 border-[#23BFD2] rounded-md px-4 shadow-inner text-[10px] font-black text-slate-600 uppercase outline-none"
                        value={provincia}
                        onChange={(e) => selectProvincia(e.target.value)}
                        disabled={!provinciasDisponibles.length}
                      >
                        {!provinciasDisponibles.length && <option value="">Pendiente de lista</option>}
                        {provinciasDisponibles.map(prov => <option key={prov} value={prov}>{prov}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-[125px_minmax(0,1fr)] items-center gap-3">
                      <label className="text-[10px] font-black text-slate-700 uppercase">Hospital</label>
                      <select
                        className="h-10 min-w-0 bg-white border-2 border-[#23BFD2] rounded-md px-4 shadow-inner text-[10px] font-black text-slate-600 uppercase outline-none"
                        value={establecimientoSeleccionado}
                        onChange={(e) => selectEstablecimiento(e.target.value)}
                        disabled={!establecimientosDisponibles.length}
                      >
                        {!establecimientosDisponibles.length && <option value="">Pendiente de lista</option>}
                        {establecimientosDisponibles.map(h => <option key={`${h.nombre}-${h.nivel}`} value={h.nombre}>{h.nombre} ({h.nivel})</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="bg-white border border-[#8ED9E5] rounded-md p-4 shadow-sm overflow-hidden">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Estado de servicios</p>
                    <div className="mt-3 space-y-2">
                      {[
                        ['Tipo', institucion],
                        ['Sedes', hospitales.length ? `${hospitales.length}` : 'sin lista'],
                        ['Nivel', hospitalActual?.nivel || '-'],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-3 text-[9px] font-black uppercase">
                          <span className="text-slate-600 truncate">{label}</span>
                          <span className="text-[#009BB5] whitespace-nowrap">{value}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="submit"
                      disabled={loading || dni.length < 8}
                      className="mt-4 w-full bg-[#005B96] text-white py-3 rounded-md font-black text-[10px] uppercase tracking-widest hover:bg-[#004C80] transition-all shadow-md border-b-4 border-blue-950 disabled:opacity-50"
                    >
                      {loading ? 'Consultando...' : 'Consultar paciente'}
                    </button>
                  </div>
                </form>
              </div>

              <div className="px-5 py-3 border-b border-[#D8E0E8] bg-white overflow-x-auto">
                <div className="flex gap-3 min-w-max">
                  {['Datos basicos', 'Descansos medicos', 'Certificados', 'Recetas', 'Historial clinico'].map((tab, index) => (
                    <div key={tab} className={index === 0 ? 'px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-wide border bg-[#009BB5] text-white border-[#009BB5]' : 'px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-wide border bg-[#F5F9FC] text-[#005B96] border-[#8ED9E5]'}>{tab}</div>
                  ))}
                </div>
              </div>

              <div className="bg-white p-5">
                <div className="bg-[#D8EEF3] border border-[#B8DDE6] px-4 py-2 text-xs font-bold italic text-slate-600">Consulta de paciente</div>
                <div className="border border-t-0 border-[#D8E0E8] p-4">
                  <div className="grid grid-cols-4 gap-4 text-[10px] font-black uppercase text-slate-700 border-b border-[#E5EDF4] pb-2">
                    <span>Documento</span>
                    <span>Numero</span>
                    <span>Establecimiento</span>
                    <span>Ubicacion</span>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-[10px] font-bold uppercase text-slate-400 py-6">
                    <span>DNI</span>
                    <span>{dni || '-'}</span>
                    <span className="truncate">-</span>
                    <span>-</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {patient && view !== 'success' && (
          <div className="animate-fade-in space-y-6">
            {/* SECCIÓN 1: DATOS DEL PACIENTE (ESTILO HIS) */}
            <div className="bg-white border border-[#D8E0E8] shadow-sm rounded overflow-hidden">
              <div className="bg-[#005B96] px-4 py-2 text-white flex justify-between items-center">
                <h3 className="text-[10px] font-black uppercase tracking-widest">I. DATOS DEL PACIENTE</h3>
                <button onClick={resetFlow} className="text-white/70 hover:text-white"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg></button>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-3">
                  <table className="w-full border-collapse border border-[#D8E0E8] text-[11px]">
                    <tbody>
                      <tr className="border-b border-[#D8E0E8]">
                        <td className="bg-[#F5F7FA] p-2 font-black text-[#1F2937] border-r border-[#D8E0E8] w-1/4 uppercase tracking-tighter">Nombre Completo</td>
                        <td className="p-2 font-black text-slate-800 uppercase" colSpan={3}>{patient.nombre}</td>
                      </tr>
                      <tr className="border-b border-[#D8E0E8]">
                        <td className="bg-[#F5F7FA] p-2 font-black text-[#1F2937] border-r border-[#D8E0E8] uppercase tracking-tighter">Documento DNI</td>
                        <td className="p-2 font-black text-[#005B96]">{patient.dni}</td>
                        <td className="bg-[#F5F7FA] p-2 font-black text-[#1F2937] border-x border-[#D8E0E8] uppercase tracking-tighter w-1/4">Historia Clínica</td>
                        <td className="p-2 font-black text-slate-800">{patient.hc}</td>
                      </tr>
                      <tr className="border-b border-[#D8E0E8]">
                        <td className="bg-[#F5F7FA] p-2 font-black text-[#1F2937] border-r border-[#D8E0E8] uppercase tracking-tighter">Edad / Sexo</td>
                        <td className="p-2 font-bold text-slate-700 uppercase">{patient.edad} · {patient.sexo}</td>
                        <td className="bg-[#F5F7FA] p-2 font-black text-[#1F2937] border-x border-[#D8E0E8] uppercase tracking-tighter">Tipo Seguro</td>
                        <td className="p-2 font-bold text-emerald-600 uppercase">{patient.seguro}</td>
                      </tr>
                      <tr>
                        <td className="bg-[#F5F7FA] p-2 font-black text-[#1F2937] border-r border-[#D8E0E8] uppercase tracking-tighter">Domicilio Actual</td>
                        <td className="p-2 font-medium text-slate-500 italic uppercase" colSpan={3}>{patient.direccion}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col items-center justify-center border border-[#D8E0E8] bg-[#F5F7FA] rounded p-3">
                  <div className="relative">
                    <img src={patient.foto} alt="PAC" onError={(e) => { e.currentTarget.src = getPatientAvatar(patient.nombre); }} className="w-24 h-24 border border-[#D8E0E8] rounded bg-white object-cover shadow-sm" />
                    <span className="absolute -right-2 -bottom-2 w-6 h-6 rounded-full bg-emerald-500 border-2 border-white text-white text-[10px] font-black flex items-center justify-center">OK</span>
                  </div>
                  <span className="text-[8px] font-black text-emerald-600 mt-3 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">IDENTIDAD VALIDADA</span>
                  <span className="text-[8px] font-bold text-slate-400 mt-1 uppercase">Consulta biometrica</span>
                </div>
              </div>
            </div>

            {/* SECCIÓN 2: DOCUMENTOS DISPONIBLES */}
            <div className="bg-white border border-[#D8E0E8] shadow-sm rounded overflow-hidden">
               <div className="bg-[#EAF4FB] px-4 py-2 border-b border-[#D8E0E8]">
                 <h3 className="text-[10px] font-black uppercase tracking-widest text-[#005B96]">II. SELECCIONAR DOCUMENTO</h3>
               </div>
               <div className="p-4 bg-white">
                 <div className="grid grid-cols-1 md:grid-cols-[190px_minmax(0,1fr)_180px] items-center gap-3">
                   <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Documento a emitir</label>
                   <select
                     className="h-11 w-full bg-[#F8FBFD] border border-[#B8DDE6] rounded px-4 text-[11px] font-black uppercase tracking-wide text-[#005B96] outline-none focus:bg-white focus:border-[#005B96]"
                     value={selectedDoc?.id || 'descanso'}
                     onChange={(e) => {
                       const docs = [
                         { id: 'descanso', label: 'Descanso Médico' },
                         { id: 'certificado', label: 'Certificado Médico' },
                         { id: 'receta', label: 'Receta Médica' },
                       ];
                       setSelectedDoc(docs.find(doc => doc.id === e.target.value) || docs[0]);
                     }}
                   >
                     <option value="descanso">DESCANSO MÉDICO</option>
                     <option value="certificado">CERTIFICADO MÉDICO</option>
                     <option value="receta">RECETA MÉDICA</option>
                   </select>
                   <div className="h-11 rounded border border-[#D8E0E8] bg-[#F5F7FA] px-3 flex items-center justify-center text-[9px] font-black uppercase tracking-widest text-slate-500">
                     Módulo activo
                   </div>
                 </div>
               </div>
            </div>

            {/* SECCIÓN 3, 4, 5 (FORMULARIO INTEGRADO) */}
            {selectedDoc && (
              <div className="space-y-6 animate-slide-up pb-12">
                <div className={`grid grid-cols-1 ${selectedDoc.id === 'receta' ? '' : 'lg:grid-cols-2'} gap-6`}>
                  {/* SECCIÓN 3: DATOS DE ATENCIÓN */}
                  <div className="bg-white border border-[#D8E0E8] shadow-sm rounded overflow-hidden">
                    <div className="bg-[#EAF4FB] px-4 py-1.5 border-b border-[#D8E0E8]">
                      <h3 className="text-[10px] font-black text-[#005B96] uppercase tracking-widest">III. DATOS DE ATENCIÓN</h3>
                    </div>
                    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                      <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Establecimiento</label><input type="text" className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded px-3 py-2 text-[11px] font-black focus:bg-white outline-none" value={formData.establecimiento} onChange={e => setFormData({...formData, establecimiento: e.target.value})} /></div>
                      <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Servicio</label><input type="text" className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded px-3 py-2 text-[11px] font-black focus:bg-white outline-none" value={formData.servicio} onChange={e => setFormData({...formData, servicio: e.target.value})} /></div>
                      <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Profesional Responsable</label><input type="text" className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded px-3 py-2 text-[11px] font-black focus:bg-white outline-none" value={formData.profesional} onChange={e => setFormData({...formData, profesional: e.target.value})} /></div>
                      <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">CMP</label><input type="text" className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded px-3 py-2 text-[11px] font-black focus:bg-white outline-none text-[#005B96]" value={formData.cmp} onChange={e => setFormData({...formData, cmp: e.target.value})} /></div>
                      
                      <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Fecha Ingreso / Atención</label><input type="date" className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded px-3 py-2 text-[11px] font-black focus:bg-white outline-none" value={formData.fechaInicio} onChange={e => setFormData({...formData, fechaInicio: e.target.value})} /></div>
                      <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Hora Ingreso</label><input type="time" className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded px-3 py-2 text-[11px] font-black focus:bg-white outline-none" value={formData.horaIngreso} onChange={e => setFormData({...formData, horaIngreso: e.target.value})} /></div>
                      
                      {(selectedDoc.id === 'descanso' || selectedDoc.id === 'certificado') && (
                        <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Días</label><input type="number" className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded px-3 py-2 text-[11px] font-black focus:bg-white outline-none" value={formData.dias} onChange={e => setFormData({...formData, dias: e.target.value})} /></div>
                      )}

                      {selectedDoc.id === 'descanso' && institucion === 'ESSALUD' && (
                        <>
                          <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Tipo de atención</label><input type="text" className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded px-3 py-2 text-[11px] font-black focus:bg-white outline-none uppercase" value={formData.tipoAtencion} onChange={e => setFormData({...formData, tipoAtencion: e.target.value})} /></div>
                          <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Días no consecutivos</label><input type="number" className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded px-3 py-2 text-[11px] font-black focus:bg-white outline-none" value={formData.diasNoConsecutivos} onChange={e => setFormData({...formData, diasNoConsecutivos: e.target.value})} /></div>
                          <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">No. CITT</label><input type="text" className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded px-3 py-2 text-[11px] font-black focus:bg-white outline-none uppercase" value={formData.numeroOrden} onChange={e => setFormData({...formData, numeroOrden: e.target.value})} placeholder="Automático si se deja vacío" /></div>
                        </>
                      )}

                      {selectedDoc.id === 'certificado' && (
                        <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Distrito de emisión</label><input type="text" className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded px-3 py-2 text-[11px] font-black focus:bg-white outline-none uppercase" value={formData.distrito} onChange={e => setFormData({...formData, distrito: e.target.value})} /></div>
                      )}
                    </div>
                  </div>

                  {selectedDoc.id !== 'receta' && (
                    <div className="bg-white border border-[#D8E0E8] shadow-sm rounded overflow-hidden">
                      <div className="bg-[#EAF4FB] px-4 py-1.5 border-b border-[#D8E0E8]">
                        <h3 className="text-[10px] font-black text-[#005B96] uppercase tracking-widest">IV. DIAGNÓSTICOS CIE-10</h3>
                      </div>
                      <div className="p-6 space-y-6">
                        <div className="space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Buscar Diagnóstico Principal</label><CIE10Autocomplete value={formData.cie} onChange={(val) => setFormData({...formData, cie: val})} /></div>
                        <div className="border border-[#D8E0E8] rounded overflow-hidden">
                           <table className="w-full text-[10px]">
                             <thead className="bg-[#F5F7FA] border-b border-[#D8E0E8] text-[#1F2937] font-black uppercase">
                               <tr><th className="p-2 text-left w-20">CÓDIGO</th><th className="p-2 text-left">DIAGNÓSTICO</th><th className="p-2 text-center w-20">TIPO</th></tr>
                             </thead>
                             <tbody>
                               {formData.cie ? (
                                 <tr className="font-bold text-slate-700">
                                   <td className="p-2 border-r border-[#D8E0E8] bg-[#EAF4FB]/50 text-[#005B96]">{formData.cie.codigoCIE}</td>
                                   <td className="p-2 border-r border-[#D8E0E8] uppercase">{formData.cie.descripcionCIE}</td>
                                   <td className="p-2 text-center">P</td>
                                 </tr>
                               ) : (
                                 <tr><td className="p-8 text-center text-slate-300 font-black uppercase italic" colSpan={3}>No se ha registrado diagnóstico</td></tr>
                               )}
                             </tbody>
                           </table>
                        </div>
                        <button className="text-[9px] font-black text-[#005B96] uppercase border border-[#005B96] px-4 py-2 rounded hover:bg-[#EAF4FB] transition-colors">+ AGREGAR DIAGNÓSTICO SECUNDARIO</button>
                      </div>
                    </div>
                  )}
                </div>

                {selectedDoc.id === 'receta' && (
                  <div className="bg-white border border-[#D8E0E8] shadow-sm rounded overflow-hidden">
                    <div className="bg-[#EAF4FB] px-4 py-1.5 border-b border-[#D8E0E8] flex items-center justify-between">
                      <h3 className="text-[10px] font-black text-[#005B96] uppercase tracking-widest">V. PRESCRIPCIÓN MÉDICA</h3>
                      <button type="button" onClick={addMed} className="text-[9px] font-black text-white uppercase bg-[#005B96] px-3 py-1.5 rounded hover:bg-[#004C80] transition-colors">+ Agregar medicamento</button>
                    </div>
                    <div className="p-5 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <label className="text-[8px] font-black text-slate-400 uppercase">No. orden</label>
                          <input value={formData.numeroOrden} onChange={(e) => setFormData({...formData, numeroOrden: e.target.value})} placeholder="Auto" className="w-full bg-white border border-[#D8E0E8] rounded px-3 py-2 text-[10px] font-black uppercase outline-none focus:border-[#005B96]" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[8px] font-black text-slate-400 uppercase">P.I.</label>
                          <input value={formData.pi} onChange={(e) => setFormData({...formData, pi: e.target.value})} placeholder={patient?.pi || 'Auto'} className="w-full bg-white border border-[#D8E0E8] rounded px-3 py-2 text-[10px] font-black uppercase outline-none focus:border-[#005B96]" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[8px] font-black text-slate-400 uppercase">Farmacia</label>
                          <input value={formData.farmacia} onChange={(e) => setFormData({...formData, farmacia: e.target.value})} className="w-full bg-white border border-[#D8E0E8] rounded px-3 py-2 text-[10px] font-black uppercase outline-none focus:border-[#005B96]" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[8px] font-black text-slate-400 uppercase">Vigencia</label>
                          <input type="date" value={formData.vigencia} onChange={(e) => setFormData({...formData, vigencia: e.target.value})} className="w-full bg-white border border-[#D8E0E8] rounded px-3 py-2 text-[10px] font-black uppercase outline-none focus:border-[#005B96]" />
                        </div>
                      </div>
                      {formData.meds.map((med, index) => {
                        const rows = catalogRowsFor(med.nombre);
                        const concentrationOptions = uniqueValues(rows.map(item => item.concentracion));
                        const presentationOptions = uniqueValues(rows.map(item => item.presentacion));
                        const routeOptions = uniqueValues(rows.map(item => item.via));
                        const frequencyOptions = uniqueValues(rows.map(item => item.frecuenciaDefault));
                        const totalQuantity = getTotalQuantity(med);
                        const medSuggestions = medSuggestionsFor(med.nombre);
                        return (
                        <div key={index} className="border border-[#D8E0E8] rounded bg-[#F8FBFD] p-4">
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-[#005B96]">Medicamento {index + 1}</p>
                            {formData.meds.length > 1 && (
                              <button type="button" onClick={() => removeMed(index)} className="text-[9px] font-black uppercase text-red-500 hover:text-red-700">Quitar</button>
                            )}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                            <div className="md:col-span-4 space-y-1">
                              <label className="text-[8px] font-black text-slate-400 uppercase">Medicamento</label>
                              <div className="relative">
                                <input
                                  value={med.nombre}
                                  onFocus={() => setActiveMedSearch(index)}
                                  onBlur={() => setTimeout(() => setActiveMedSearch(null), 140)}
                                  onChange={(e) => {
                                    setActiveMedSearch(index);
                                    updateMedCatalog(index, 'nombre', e.target.value);
                                  }}
                                  placeholder="Buscar medicamento PNUME"
                                  className="w-full bg-white border border-[#D8E0E8] rounded px-3 py-2 pr-8 text-[10px] font-black uppercase outline-none focus:border-[#005B96] focus:ring-2 focus:ring-[#D9EEF8]"
                                />
                                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">?</span>
                                {activeMedSearch === index && medSuggestions.length > 0 && (
                                  <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded border border-[#BFD8E6] bg-white shadow-xl">
                                    {medSuggestions.map((name) => (
                                      <button
                                        key={name}
                                        type="button"
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          updateMedCatalog(index, 'nombre', name);
                                          setActiveMedSearch(null);
                                        }}
                                        className="block w-full border-b border-[#EEF4F8] px-3 py-2 text-left text-[10px] font-black uppercase text-slate-700 hover:bg-[#EAF4FB] hover:text-[#005B96] last:border-b-0"
                                      >
                                        {name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="md:col-span-2 space-y-1">
                              <label className="text-[8px] font-black text-slate-400 uppercase">Concentración</label>
                              {concentrationOptions.length ? (
                                <select value={med.concentracion} onChange={(e) => updateMedCatalog(index, 'concentracion', e.target.value)} className="w-full bg-white border border-[#D8E0E8] rounded px-2 py-2 text-[10px] font-black uppercase outline-none focus:border-[#005B96]">
                                  <option value="">Seleccionar</option>
                                  {concentrationOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                </select>
                              ) : (
                                <input value={med.concentracion} onChange={(e) => updateMedCatalog(index, 'concentracion', e.target.value)} placeholder="Ej: 500 MG" className="w-full bg-white border border-[#D8E0E8] rounded px-3 py-2 text-[10px] font-black uppercase outline-none focus:border-[#005B96]" />
                              )}
                            </div>
                            <div className="md:col-span-2 space-y-1">
                              <label className="text-[8px] font-black text-slate-400 uppercase">Presentación</label>
                              <select value={med.presentacion} onChange={(e) => updateMedCatalog(index, 'presentacion', e.target.value)} className="w-full bg-white border border-[#D8E0E8] rounded px-2 py-2 text-[10px] font-black uppercase outline-none focus:border-[#005B96]">
                                <option value="">Seleccionar</option>
                                {[...(presentationOptions.length ? presentationOptions : defaultPresentations)].map(opt => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            </div>
                            <div className="md:col-span-2 space-y-1">
                              <label className="text-[8px] font-black text-slate-400 uppercase">Dosis</label>
                              <input value={med.cantidad} onChange={(e) => updateMedCatalog(index, 'cantidad', e.target.value)} placeholder="Ej: 1 / 500" className="w-full bg-white border border-[#D8E0E8] rounded px-3 py-2 text-[10px] font-black uppercase outline-none focus:border-[#005B96]" />
                            </div>
                            <div className="md:col-span-2 space-y-1">
                              <label className="text-[8px] font-black text-slate-400 uppercase">Unidad</label>
                              <select value={med.unidad} onChange={(e) => updateMedCatalog(index, 'unidad', e.target.value)} className="w-full bg-white border border-[#D8E0E8] rounded px-2 py-2 text-[10px] font-black uppercase outline-none focus:border-[#005B96]">
                                <option>MG</option>
                                <option>ML</option>
                                <option>G</option>
                                <option>UI</option>
                                <option>MCG</option>
                                <option>TABLETA</option>
                                <option>AMPOLLA</option>
                                <option>GOTAS</option>
                              </select>
                            </div>
                            <div className="md:col-span-2 space-y-1">
                              <label className="text-[8px] font-black text-slate-400 uppercase">Vía</label>
                              <select value={med.via} onChange={(e) => updateMedCatalog(index, 'via', e.target.value)} className="w-full bg-white border border-[#D8E0E8] rounded px-2 py-2 text-[10px] font-black uppercase outline-none focus:border-[#005B96]">
                                {[...(routeOptions.length ? routeOptions : defaultRoutes)].map(opt => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            </div>
                            <div className="md:col-span-3 space-y-1">
                              <label className="text-[8px] font-black text-slate-400 uppercase">Frecuencia</label>
                              <select value={med.frecuencia} onChange={(e) => updateMedCatalog(index, 'frecuencia', e.target.value)} className="w-full bg-white border border-[#D8E0E8] rounded px-2 py-2 text-[10px] font-black uppercase outline-none focus:border-[#005B96]">
                                <option value="">Seleccionar</option>
                                {[...(frequencyOptions.length ? frequencyOptions : defaultFrequencies)].map(opt => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            </div>
                            <div className="md:col-span-2 space-y-1">
                              <label className="text-[8px] font-black text-slate-400 uppercase">Días</label>
                              <input value={med.duracion} onChange={(e) => updateMedCatalog(index, 'duracion', e.target.value)} placeholder="5" className="w-full bg-white border border-[#D8E0E8] rounded px-3 py-2 text-[10px] font-black uppercase outline-none focus:border-[#005B96]" />
                            </div>
                            <div className="md:col-span-3 space-y-1">
                              <label className="text-[8px] font-black text-slate-400 uppercase">Cantidad total</label>
                              <div className="h-[34px] w-full bg-[#EAF4FB] border border-[#B8DDE6] rounded px-3 py-2 text-[10px] font-black uppercase text-[#005B96]">
                                {totalQuantity || 'Completar dosis/frecuencia/días'}
                              </div>
                            </div>
                            <div className="md:col-span-12 space-y-1">
                              <label className="text-[8px] font-black text-slate-400 uppercase">Indicaciones</label>
                              <input value={med.indicacion} onChange={(e) => updateMedCatalog(index, 'indicacion', e.target.value)} placeholder="Después de alimentos / diluir / aplicar según indicación" className="w-full bg-white border border-[#D8E0E8] rounded px-3 py-2 text-[10px] font-black uppercase outline-none focus:border-[#005B96]" />
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* SECCIÓN 5: OBSERVACIONES MÉDICAS */}
                <div className="bg-white border border-[#D8E0E8] shadow-sm rounded overflow-hidden">
                  <div className="bg-[#EAF4FB] px-4 py-1.5 border-b border-[#D8E0E8] flex justify-between items-center">
                    <h3 className="text-[10px] font-black text-[#005B96] uppercase tracking-widest">V. OBSERVACIONES Y RECOMENDACIONES CLÍNICAS</h3>
                    <div className="flex items-center space-x-2 cursor-pointer" onClick={() => setFormData({...formData, usarObsAuto: !formData.usarObsAuto})}>
                      <div className={`w-8 h-4 rounded-full transition-all relative ${formData.usarObsAuto ? 'bg-emerald-500' : 'bg-slate-300'}`}><div className={`absolute top-0.5 left-0.5 bg-white w-3 h-3 rounded-full transition-all ${formData.usarObsAuto ? 'translate-x-4' : ''}`}></div></div>
                      <span className="text-[9px] font-black text-slate-500 uppercase">Auto-Texto HIS</span>
                    </div>
                  </div>
                  <div className="p-6">
                    <textarea 
                      className="w-full bg-[#F5F7FA] border border-[#D8E0E8] rounded px-5 py-4 outline-none h-40 text-[11px] font-black focus:bg-white focus:border-[#005B96] transition-all resize-none shadow-inner uppercase"
                      placeholder="Indique las observaciones adicionales pertinentes al acto médico..."
                      value={formData.obsCustom} onChange={e => setFormData({...formData, obsCustom: e.target.value})}
                    />
                  </div>
                </div>

                {/* SECCIÓN 6: ACCIONES */}
                <div className="flex flex-col items-center justify-center gap-3 pt-2 pb-6">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Revise los datos antes de emitir el documento</p>
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full">
                    <button onClick={() => setSelectedDoc(null)} className="w-full sm:w-40 px-8 py-3 bg-white text-slate-500 font-black text-[10px] uppercase tracking-widest rounded border border-[#D8E0E8] shadow-sm hover:bg-slate-50 hover:text-slate-700 transition-all">CANCELAR</button>
                  <button 
                    onClick={() => emitOfficialDocument('pdf')} disabled={loading || (selectedDoc.id !== 'receta' && !formData.cie)}
                    className="w-full sm:w-40 px-8 py-3 bg-[#005B96] text-white font-black text-[10px] uppercase tracking-widest rounded shadow-lg hover:bg-blue-900 disabled:opacity-50 border-b-4 border-blue-950 transition-all"
                  >
                    {loading ? 'GENERANDO...' : 'EMITIR'}
                  </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'success' && (
          <div className="fixed inset-0 z-[100] bg-[#0F172A]/55 backdrop-blur-[2px] animate-fade-in flex items-center justify-center p-6">
            <div className="bg-white border border-[#C9D8E6] shadow-2xl rounded-md max-w-lg w-full overflow-hidden">
               <div className="bg-[#005B96] px-6 py-3 text-white flex items-center justify-between border-b-4 border-[#00A6C8]">
                 <div>
                   <h3 className="text-[11px] font-black uppercase tracking-[0.22em]">Registro de emisión</h3>
                   <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-blue-100 mt-1">Sistema institucional de documentos</p>
                 </div>
                 <span className="text-[8px] font-black uppercase tracking-widest bg-white text-[#005B96] px-2.5 py-1 rounded-sm shadow-sm">{institucion}</span>
               </div>
               <div className="px-8 py-7 space-y-5">
                 <div className="flex items-start gap-4">
                   <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center text-2xl border border-emerald-200 shrink-0">?</div>
                   <div className="pt-0.5">
                     <p className="text-[17px] font-black text-slate-800 uppercase tracking-tight">Emisión registrada correctamente</p>
                     <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide leading-relaxed mt-2">
                       Documento de salud generado para validación institucional, entrega correspondiente y registro interno.
                     </p>
                   </div>
                 </div>

                 <div className="border border-[#C9D8E6] rounded-md overflow-hidden">
                   <div className="bg-[#EAF5FB] border-b border-[#C9D8E6] px-4 py-2 flex items-center justify-between">
                     <span className="text-[9px] font-black uppercase tracking-[0.18em] text-[#005B96]">Constancia de emisión</span>
                     <span className="text-[8px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-sm">Validado</span>
                   </div>
                   <div className="p-4 bg-white">
                     <div className="grid grid-cols-[105px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[10px] uppercase">
                       <span className="text-slate-400 font-black tracking-wide">Paciente</span>
                       <span className="text-slate-800 font-black truncate">{patient?.nombre}</span>
                       <span className="text-slate-400 font-black tracking-wide">DNI</span>
                       <span className="text-slate-800 font-black">{patient?.dni}</span>
                       <span className="text-slate-400 font-black tracking-wide">Documento</span>
                       <span className="text-[#005B96] font-black">{selectedDoc?.label}</span>
                       <span className="text-slate-400 font-black tracking-wide">Destino</span>
                       <span className="text-slate-800 font-black">{selectedDoc?.id === 'receta' ? 'FARMACIA' : 'RECEPCIÓN'}</span>
                     </div>
                   </div>
                 </div>

                 <div className="bg-[#F7FAFC] border-l-4 border-[#00A6C8] px-4 py-3">
                   <p className="text-[10px] font-bold uppercase tracking-wide leading-relaxed text-slate-600">
                     {selectedDoc?.id === 'receta'
                       ? 'La receta queda lista para farmacia. El paciente debe presentar DNI vigente para validación, entrega e impresión.'
                       : 'El documento queda listo para recepción. El paciente debe presentar DNI vigente para entrega e impresión.'}
                   </p>
                 </div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                   <button
                     onClick={() => setReceptionSent(true)}
                     className={`w-full py-3 rounded-sm font-black text-[10px] uppercase tracking-widest shadow-sm transition-all border ${receptionSent ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-[#005B96] border-[#005B96] text-white hover:bg-[#004C80]'}`}
                   >
                     {receptionSent ? 'Enviado' : selectedDoc?.id === 'receta' ? 'Enviar farmacia' : 'Enviar recepción'}
                   </button>
                   <button
                     onClick={downloadIssuedPdf}
                     disabled={!pdfUrl}
                     className="w-full py-3 rounded-sm font-black text-[10px] uppercase tracking-widest shadow-sm bg-white text-[#005B96] hover:bg-[#F0F7FC] disabled:opacity-50 transition-all border border-[#8BB8D8]"
                   >
                     Descargar informe
                   </button>
                 </div>
                 {receptionSent && (
                   <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-sm py-2 text-center">
                     {selectedDoc?.id === 'receta' ? 'Enviado a farmacia para validación y entrega con DNI' : 'Enviado a recepción para entrega e impresión'}
                   </p>
                 )}
                 <div className="pt-1 text-center">
                   <button onClick={resetFlow} className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-[#005B96] transition-colors">
                     Atender siguiente paciente
                   </button>
                 </div>
               </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;

