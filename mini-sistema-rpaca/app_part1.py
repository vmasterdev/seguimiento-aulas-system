"""
Mini Sistema RPACA - Aplicación Principal
Para presentación de trabajo de grado - Maestría
"""

from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from werkzeug.utils import secure_filename
import pandas as pd
import os
from datetime import datetime

from models import db, init_db, Docente, NRC, RevisionNRC, CorreoEnviado

app = Flask(__name__)
app.config['SECRET_KEY'] = 'mini-sistema-rpaca-2024'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///rpaca.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'uploads'

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
init_db(app)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() == 'csv'

def parse_csv_rpaca(filepath):
    try:
        encodings = ['utf-8', 'latin-1', 'iso-8859-1']
        df = None
        for encoding in encodings:
            try:
                df = pd.read_csv(filepath, sep=';', encoding=encoding)
                break
            except:
                continue
        if df is None:
            return None, "Error de codificación"
        df.columns = [col.strip().upper() for col in df.columns]
        return df, None
    except Exception as e:
        return None, str(e)

@app.route('/')
def index():
    stats = {
        'total_nrcs': NRC.query.count(),
        'total_docentes': Docente.query.count(),
        'nrcs_pendientes': NRC.query.filter_by(estado_revision='PENDIENTE').count(),
        'nrcs_revisados': NRC.query.filter(NRC.estado_revision != 'PENDIENTE').count(),
        'nrcs_aprobados': NRC.query.filter_by(estado_revision='APROBADO').count(),
        'correos_enviados': CorreoEnviado.query.count()
    }
    ultimos_nrcs = NRC.query.order_by(NRC.fecha_carga.desc()).limit(10).all()
    return render_template('index.html', stats=stats, ultimos_nrcs=ultimos_nrcs)

@app.route('/carga-rpaca', methods=['GET', 'POST'])
def carga_rpaca():
    if request.method == 'POST':
        if 'archivo' not in request.files:
            flash('No se seleccionó archivo', 'error')
            return redirect(request.url)
        file = request.files['archivo']
        if file.filename == '':
            flash('No se seleccionó archivo', 'error')
            return redirect(request.url)
        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"{timestamp}_{filename}"
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            
            df, error = parse_csv_rpaca(filepath)
            if error:
                flash(f'Error: {error}', 'error')
                return redirect(request.url)
            
            nrcs_creados = 0
            docentes_creados = 0
            
            for _, row in df.iterrows():
                nrc_valor = str(row.get('NRC', '')).strip()
                if not nrc_valor:
                    continue
                periodo = str(row.get('PERIODO', '')).strip()
                nrc_existente = NRC.query.filter_by(nrc=nrc_valor, periodo=periodo).first()
                
                id_docente = str(row.get('ID_DOCENTE', '')).strip() if pd.notna(row.get('ID_DOCENTE')) else None
                nombre_docente = str(row.get('NOMBRE_DOCENTE', '')).strip() if pd.notna(row.get('NOMBRE_DOCENTE')) else None
                
                docente_id = None
                if id_docente and nombre_docente:
                    docente = Docente.query.filter_by(identificacion=id_docente).first()
                    if not docente:
                        docente = Docente(
                            identificacion=id_docente,
                            nombre=nombre_docente,
                            departamento=str(row.get('DEPARTAMENTO_RESPONSABLE', '')).strip()[:100] if pd.notna(row.get('DEPARTAMENTO_RESPONSABLE')) else None
                        )
                        db.session.add(docente)
                        db.session.flush()
                        docentes_creados += 1
                    docente_id = docente.id
                
                dias_str = ''
                for dia, col in [('L','L'),('M','M'),('I','I'),('J','J'),('V','V'),('S','S'),('D','D')]:
                    if col in row and pd.notna(row[col]) and str(row[col]).strip():
                        dias_str += dia + ','
                dias_str = dias_str.rstrip(',')
                
                datos_nrc = {
                    'periodo': periodo,
                    'nrc': nrc_valor,
                    'secuencia': str(row.get('SECUENCIA', '')).strip()[:5] if pd.notna(row.get('SECUENCIA')) else None,
                    'alfa': str(row.get('ALFA', '')).strip()[:10] if pd.notna(row.get('ALFA')) else None,
                    'num': str(row.get('NUM', '')).strip()[:10] if pd.notna(row.get('NUM')) else None,
                    'estado_nrc': str(row.get('ESTADO_NRC', '')).strip()[:20] if pd.notna(row.get('ESTADO_NRC')) else None,
                    'titulo': str(row.get('TITULO', '')).strip()[:200] if pd.notna(row.get('TITULO')) else None,
                    'credito': int(row.get('CREDITO', 0)) if pd.notna(row.get('CREDITO')) else None,
                    'intensidad_horaria': int(row.get('INTENSIDAD_HORARIA', 0)) if pd.notna(row.get('INTENSIDAD_HORARIA')) else None,
                    'rectoria': str(row.get('RECTORIA', '')).strip()[:50] if pd.notna(row.get('RECTORIA')) else None,
                    'desc_rectoria': str(row.get('DESC_RECTORIA', '')).strip()[:100] if pd.notna(row.get('DESC_RECTORIA')) else None,
                    'sede': str(row.get('SEDE', '')).strip()[:10] if pd.notna(row.get('SEDE')) else None,
                    'desc_sede': str(row.get('DESC_SEDE', '')).strip()[:100] if pd.notna(row.get('DESC_SEDE')) else None,
                    'facultad': str(row.get('FACULTAD_RESPONSABLE', '')).strip()[:100] if pd.notna(row.get('FACULTAD_RESPONSABLE')) else None,
                    'departamento': str(row.get('DEPARTAMENTO_RESPONSABLE', '')).strip()[:100] if pd.notna(row.get('DEPARTAMENTO_RESPONSABLE')) else None,
                    'cupo': int(row.get('CUPO', 0)) if pd.notna(row.get('CUPO')) else None,
                    'inscritos': int(row.get('INSCRITOS', 0)) if pd.notna(row.get('INSCRITOS')) else None,
                    'saldo': int(row.get('SALDO', 0)) if pd.notna(row.get('SALDO')) else None,
                    'docente_id': docente_id,
                    'identificacion_docente': id_docente[:20] if id_docente else None,
                    'nombre_docente': nombre_docente[:200] if nombre_docente else None,
                    'parte_periodo': str(row.get('PARTE_PERIODO', '')).strip()[:10] if pd.notna(row.get('PARTE_PERIODO')) else None,
                    'edificio': str(row.get('EDIFICIO', '')).strip()[:50] if pd.notna(row.get('EDIFICIO')) else None,
                    'salon': str(row.get('SALON', '')).strip()[:50] if pd.notna(row.get('SALON')) else None,
                    'fecha_inicial': str(row.get('FECHA_INICIAL_1', '')).strip()[:20] if pd.notna(row.get('FECHA_INICIAL_1')) else None,
                    'fecha_final': str(row.get('FECHA_FINAL_1', '')).strip()[:20] if pd.notna(row.get('FECHA_FINAL_1')) else None,
                    'hora_inicio': str(row.get('HI', '')).strip()[:10] if pd.notna(row.get('HI')) else None,
                    'hora_fin': str(row.get('HF', '')).strip()[:10] if pd.notna(row.get('HF')) else None,
                    'dias': dias_str,
                    'archivo_origen': filename
                }
                
                if nrc_existente:
                    for key, value in datos_nrc.items():
                        setattr(nrc_existente, key, value)
                else:
                    nuevo_nrc = NRC(**datos_nrc)
                    db.session.add(nuevo_nrc)
                    nrcs_creados += 1
            
            db.session.commit()
            flash(f'Carga exitosa: {nrcs_creados} NRCs creados, {docentes_creados} docentes nuevos', 'success')
            return redirect(url_for('nrc_globales'))
    return render_template('carga_rpaca.html')
