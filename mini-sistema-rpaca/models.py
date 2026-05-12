"""
Mini Sistema RPACA - Modelos de Datos
Para presentación de trabajo de grado - Maestría
Sistema independiente - NO modificar el sistema principal
"""
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class Docente(db.Model):
    """Docentes registrados en el sistema"""
    __tablename__ = 'docentes'
    
    id = db.Column(db.Integer, primary_key=True)
    identificacion = db.Column(db.String(20), unique=True, nullable=True)
    nombre = db.Column(db.String(200), nullable=False)
    email = db.Column(db.String(200), nullable=True)
    departamento = db.Column(db.String(100), nullable=True)
    activo = db.Column(db.Boolean, default=True)
    
    # Relación con NRCs
    nrcs = db.relationship('NRC', backref='docente', lazy=True)
    
    def __repr__(self):
        return f'<Docente {self.nombre}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'identificacion': self.identificacion,
            'nombre': self.nombre,
            'email': self.email,
            'departamento': self.departamento,
            'activo': self.activo,
            'total_nrcs': len(self.nrcs)
        }

class NRC(db.Model):
    """Números de Referencia de Curso cargados desde RPACA"""
    __tablename__ = 'nrcs'
    
    id = db.Column(db.Integer, primary_key=True)
    periodo = db.Column(db.String(10), nullable=False)
    nrc = db.Column(db.String(10), nullable=False)
    secuencia = db.Column(db.String(5), nullable=True)
    alfa = db.Column(db.String(10), nullable=True)
    num = db.Column(db.String(10), nullable=True)
    estado_nrc = db.Column(db.String(20), nullable=True)
    titulo = db.Column(db.String(200), nullable=True)
    credito = db.Column(db.Integer, nullable=True)
    intensidad_horaria = db.Column(db.Integer, nullable=True)
    rectoria = db.Column(db.String(50), nullable=True)
    desc_rectoria = db.Column(db.String(100), nullable=True)
    sede = db.Column(db.String(10), nullable=True)
    desc_sede = db.Column(db.String(100), nullable=True)
    facultad = db.Column(db.String(100), nullable=True)
    departamento = db.Column(db.String(100), nullable=True)
    cupo = db.Column(db.Integer, nullable=True)
    inscritos = db.Column(db.Integer, nullable=True)
    saldo = db.Column(db.Integer, nullable=True)
    
    # Docente asignado
    docente_id = db.Column(db.Integer, db.ForeignKey('docentes.id'), nullable=True)
    identificacion_docente = db.Column(db.String(20), nullable=True)
    nombre_docente = db.Column(db.String(200), nullable=True)
    
    # Horario
    parte_periodo = db.Column(db.String(10), nullable=True)
    edificio = db.Column(db.String(50), nullable=True)
    salon = db.Column(db.String(50), nullable=True)
    fecha_inicial = db.Column(db.String(20), nullable=True)
    fecha_final = db.Column(db.String(20), nullable=True)
    hora_inicio = db.Column(db.String(10), nullable=True)
    hora_fin = db.Column(db.String(10), nullable=True)
    dias = db.Column(db.String(50), nullable=True)  # L,M,I,J,V,S,D
    
    # Campos de revisión y calificación
    estado_revision = db.Column(db.String(20), default='PENDIENTE')  # PENDIENTE, REVISADO, APROBADO, RECHAZADO
    observaciones = db.Column(db.Text, nullable=True)
    calificacion = db.Column(db.String(10), nullable=True)  # A, B, C, etc.
    fecha_revision = db.Column(db.DateTime, nullable=True)
    revisado_por = db.Column(db.String(100), nullable=True)
    
    # Metadatos
    fecha_carga = db.Column(db.DateTime, default=datetime.utcnow)
    archivo_origen = db.Column(db.String(200), nullable=True)
    
    def __repr__(self):
        return f'<NRC {self.nrc} - {self.titulo}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'periodo': self.periodo,
            'nrc': self.nrc,
            'secuencia': self.secuencia,
            'alfa': self.alfa,
            'num': self.num,
            'titulo': self.titulo,
            'estado_nrc': self.estado_nrc,
            'credito': self.credito,
            'cupo': self.cupo,
            'inscritos': self.inscritos,
            'saldo': self.saldo,
            'docente_nombre': self.docente.nombre if self.docente else self.nombre_docente,
            'departamento': self.departamento,
            'facultad': self.facultad,
            'estado_revision': self.estado_revision,
            'calificacion': self.calificacion,
            'observaciones': self.observaciones,
            'fecha_revision': self.fecha_revision.strftime('%Y-%m-%d %H:%M') if self.fecha_revision else None
        }

class RevisionNRC(db.Model):
    """Histórico de revisiones realizadas a NRCs"""
    __tablename__ = 'revisiones_nrc'
    
    id = db.Column(db.Integer, primary_key=True)
    nrc_id = db.Column(db.Integer, db.ForeignKey('nrcs.id'), nullable=False)
    estado_anterior = db.Column(db.String(20), nullable=True)
    estado_nuevo = db.Column(db.String(20), nullable=False)
    observaciones = db.Column(db.Text, nullable=True)
    calificacion = db.Column(db.String(10), nullable=True)
    fecha = db.Column(db.DateTime, default=datetime.utcnow)
    revisado_por = db.Column(db.String(100), nullable=True)
    
    nrc = db.relationship('NRC', backref='revisiones')

class CorreoEnviado(db.Model):
    """Registro de correos enviados"""
    __tablename__ = 'correos_enviados'
    
    id = db.Column(db.Integer, primary_key=True)
    destinatario = db.Column(db.String(200), nullable=False)
    tipo_destinatario = db.Column(db.String(20), nullable=False)  # DOCENTE, COORDINACION
    asunto = db.Column(db.String(300), nullable=False)
    contenido = db.Column(db.Text, nullable=True)
    archivo_adjunto = db.Column(db.String(300), nullable=True)
    fecha_envio = db.Column(db.DateTime, default=datetime.utcnow)
    estado = db.Column(db.String(20), default='ENVIADO')  # ENVIADO, ERROR
    nrcs_incluidos = db.Column(db.Text, nullable=True)  # JSON con IDs de NRCs
    
    def to_dict(self):
        return {
            'id': self.id,
            'destinatario': self.destinatario,
            'tipo_destinatario': self.tipo_destinatario,
            'asunto': self.asunto,
            'fecha_envio': self.fecha_envio.strftime('%Y-%m-%d %H:%M'),
            'estado': self.estado
        }

class Configuracion(db.Model):
    """Configuración del sistema"""
    __tablename__ = 'configuracion'
    
    id = db.Column(db.Integer, primary_key=True)
    clave = db.Column(db.String(50), unique=True, nullable=False)
    valor = db.Column(db.Text, nullable=True)
    descripcion = db.Column(db.String(200), nullable=True)

# Funciones de utilidad
def init_db(app):
    """Inicializar la base de datos"""
    db.init_app(app)
    with app.app_context():
        db.create_all()
        
        # Crear configuración por defecto
        if not Configuracion.query.filter_by(clave='periodo_activo').first():
            config = Configuracion(
                clave='periodo_activo',
                valor='202615',
                descripcion='Período académico activo'
            )
            db.session.add(config)
            db.session.commit()
